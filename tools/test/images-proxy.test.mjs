/* ============================================================
 * functions/api/images.js 单测
 * ------------------------------------------------------------
 * 该函数此前零覆盖，却是最容易静默损坏的一个：所有失败路径都只
 * console.warn、不抛错，出问题只会表现成「站点莫名其妙只剩兜底图」。
 *
 * 用 mock fetch + mock Cache API 在 Node 里跑通全部路径：
 *   - 缓存命中/未命中、是否入缓存
 *   - 分页扇出（关键安全性质：per_page 不控制请求次数）
 *   - 部分页失败、失败页不进缓存
 *   - 方法校验、缺 token、非 JSON 错误页
 * ============================================================ */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onRequest as imagesHandler } from '../../functions/api/images.js';

const UP = 'https://7bu.top/api/v1/images';

/** 构造图床一页响应:total / last_page / data[] */
function upstreamPage(page, perPage, total) {
  const lastPage = Math.ceil(total / perPage);
  const from = (page - 1) * perPage;
  const n = Math.max(0, Math.min(perPage, total - from));
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({
      origin_name: `p${page}-${i}.jpg`,
      links: { url: `https://bu.dusays.com/p${page}-${i}.jpg`, thumbnail_url: `https://bu.dusays.com/t${page}-${i}.jpg` },
    });
  }
  return new Response(JSON.stringify({ data: { data, total, last_page: lastPage, current_page: page } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 装上 mock fetch / caches.default,返回一个「本轮抓了哪些 URL」的记录器 */
function install({ total = 0, perPage = 40, failPages = [], nonJsonStatus = null } = {}) {
  const calls = [];
  const cacheStore = new Map();
  const cacheHits = { match: 0, put: 0 };

  globalThis.caches = {
    default: {
      async match(key) {
        cacheHits.match++;
        const v = cacheStore.get(key);
        return v ? v.clone() : undefined;
      },
      async put(key, res) {
        cacheHits.put++;
        cacheStore.set(key, res);
      },
    },
  };

  globalThis.fetch = vi.fn(async (url) => {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('page') || 1);
    const effPerPage = Number(u.searchParams.get('per_page') || perPage);
    calls.push({ page, per_page: effPerPage });

    if (nonJsonStatus && page === 1) {
      return new Response('<html>cdn blocked</html>', { status: nonJsonStatus, headers: { 'Content-Type': 'text/html' } });
    }
    if (failPages.includes(page)) return new Response('boom', { status: 500 });
    return upstreamPage(page, effPerPage, total);
  });

  return { calls, cacheStore, cacheHits };
}

function req(url = 'https://lumina.test/api/images', method = 'GET') {
  return new Request(url, { method });
}

const ENV = { QUBU_TOKEN: 'test-token' };

describe('functions/api/images — 方法与鉴权', () => {
  it('非 GET/HEAD → 405 且带 Allow', async () => {
    const res = await imagesHandler({ request: req('https://lumina.test/api/images', 'POST'), env: ENV });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toContain('GET');
  });

  it('未配置 token → 200 + status:false(前端静默回退),且不进缓存', async () => {
    const { calls, cacheHits } = install({ total: 10 });
    const res = await imagesHandler({ request: req(), env: {} });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe(false);
    expect(body.message).toContain('QUBU_TOKEN');
    expect(calls).toHaveLength(0);
    expect(cacheHits.put).toBe(0);
  });

  it('有 token 时带上 Authorization: Bearer', async () => {
    const { calls } = install({ total: 1 });
    await imagesHandler({ request: req(), env: ENV });
    expect(calls).toHaveLength(1);
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });
});

describe('functions/api/images — 分页扇出', () => {
  it('per_page 不控制请求次数:per_page=1 也只请求 1 页', async () => {
    const { calls } = install({ total: 1000 });
    await imagesHandler({ request: req('https://lumina.test/api/images?per_page=1'), env: ENV });
    // 修复前:per_page=1 → last_page=1000 → 发出 1000 次请求(还会撞 50 次子请求上限)
    expect(calls).toHaveLength(1);
    expect(calls[0].per_page).toBe(40);
  });

  it('单页装下 → 只请求 1 页', async () => {
    const { calls } = install({ total: 12 });
    const res = await imagesHandler({ request: req(), env: ENV });
    expect(calls).toHaveLength(1);
    expect((await res.json()).data.data).toHaveLength(12);
  });

  it('多页 → 内部固定每页 40,响应按 per_page 截断,缓存仍存全量目录', async () => {
    const { calls, cacheHits } = install({ total: 1000 });
    const res = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=100'), env: ENV });
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.per_page === 40)).toBe(true);
    const body = await res.json();
    expect(body.data.data).toHaveLength(100);  // 拉了 120 张,但只回给调用方 100 张
    expect(body.data.total).toBe(1000);        // 真实值,不是 items.length
    expect(body.data.returned).toBe(100);
    expect(body.data.truncated).toBe(true);
    expect(cacheHits.put).toBe(1);             // 全量目录(120 张)入缓存
  });

  it('冷缓存小 per_page:只回 1 张,但缓存存全量页(后续大 per_page 直接切片命中)', async () => {
    const { calls, cacheHits } = install({ total: 30 }); // 一页(40)装得下
    const r1 = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=1'), env: ENV });
    expect((await r1.json()).data.data).toHaveLength(1);
    expect(cacheHits.put).toBe(1); // 缓存的是 30 张全量页,不是 1 张
    const after = calls.length;

    const r2 = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=20'), env: ENV });
    const b2 = await r2.json();
    expect(b2.data.data).toHaveLength(20); // 缓存 30 张足够 → 切片即可
    expect(calls.length).toBe(after);      // 不回源
    expect(b2.data.truncated).toBe(true);  // total 30 > 20,如实标注
  });

  it('缓存目录不足且上游还有更多 → 视为未命中回源补齐(防小请求污染缓存)', async () => {
    const { calls } = install({ total: 1000 });
    // 先让 per_page=1 污染缓存(只会拉 1 页 = 40 张)
    await imagesHandler({ request: req('https://lumina.test/api/images?per_page=1'), env: ENV });
    const after = calls.length;

    const r2 = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=200'), env: ENV });
    const b2 = await r2.json();
    expect(b2.data.data).toHaveLength(200); // 40 张不够 → 回源补拉 5 页
    expect(calls.length).toBe(after + 5);
    expect(b2.data.truncated).toBe(true);
  });

  it('并发不超过 Workers 的 6 条上限', async () => {
    let live = 0;
    let peak = 0;
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = vi.fn(async (url) => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return upstreamPage(page, 40, 400);
    });
    await imagesHandler({ request: req('https://lumina.test/api/images?per_page=400'), env: ENV });
    expect(peak).toBeLessThanOrEqual(6);
  });
});

describe('functions/api/images — 缓存', () => {
  it('首次成功后入缓存,第二次不再打上游', async () => {
    const { calls, cacheStore } = install({ total: 20 });
    await imagesHandler({ request: req(), env: ENV });
    expect(cacheStore.size).toBe(1);
    const after = calls.length;

    await imagesHandler({ request: req(), env: ENV });
    expect(calls.length).toBe(after); // 上游请求数未增加
  });

  it('边缘缓存命中时按本次 per_page 截断', async () => {
    const { calls } = install({ total: 100 });
    await imagesHandler({ request: req('https://lumina.test/api/images?per_page=100'), env: ENV });
    const after = calls.length;

    const res = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=10'), env: ENV });
    const body = await res.json();
    expect(body.data.data).toHaveLength(10);
    expect(calls.length).toBe(after); // 截断不发新的上游请求
  });

  it('部分页失败 → 报 failed_pages 且【不】入缓存', async () => {
    const { calls, cacheStore, cacheHits } = install({ total: 200, failPages: [3] });
    const res = await imagesHandler({ request: req('https://lumina.test/api/images?per_page=200'), env: ENV });
    const body = await res.json();
    expect(body.data.failed_pages).toEqual([3]);
    expect(body.data.data).toHaveLength(160); // 5 页中第 3 页失败 → 4 × 40
    expect(body.data.total).toBe(200);
    expect(body.data.truncated).toBe(true);
    expect(cacheHits.put).toBe(0);
    expect(cacheStore.size).toBe(0);
    expect(calls).toHaveLength(5); // 200/40 = 5 页,失败页也试了
  });
});

describe('functions/api/images — 上游异常', () => {
  it('上游首屏返回 HTML → 包装成结构化 JSON(否则前端解析失败)', async () => {
    install({ total: 0, nonJsonStatus: 403 });
    const res = await imagesHandler({ request: req(), env: ENV });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.status).toBe(false);
    expect(body.message).toContain('非 JSON');
  });

  it('上游全部网络失败 → 502', async () => {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await imagesHandler({ request: req(), env: ENV });
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe(false);
  });

  it('上游超时 → 502 且 message 点明超时', async () => {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    const err = new Error('The operation timed out');
    err.name = 'TimeoutError';
    globalThis.fetch = vi.fn(async () => { throw err; });
    const res = await imagesHandler({ request: req(), env: ENV });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain('超时');
  });

  it('每个上游请求都带 signal(无 signal 会永久挂起)', async () => {
    install({ total: 1 });
    await imagesHandler({ request: req(), env: ENV });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(typeof init.signal.aborted).toBe('boolean');
  });
});
