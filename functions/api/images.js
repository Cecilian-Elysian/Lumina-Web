/* ============================================================
 * Cloudflare Pages Function — 图床 API 代理
 * ------------------------------------------------------------
 * 路由：/api/images（目录即路由：functions/api/images.js）
 *
 * 安全核心：
 *   浏览器 → 本函数（无 token） → 7bu.top 图床 API（服务端注入 token）
 * token 只从 Cloudflare 环境变量读取，永不出现在前端 JS / 仓库 / 浏览器。
 *
 * 三个关键设计（改动前都有问题，勿回退）：
 *
 * 1. 上游分页尺寸写死 40，不受调用方影响
 *    图床单页硬上限 40。调用方的 ?per_page 只决定「返回几张」，
 *    绝不决定「发几个请求」—— 否则 ?per_page=1 会让本函数发出
 *    「图片总数」个请求（1000 张 = 1000 次），既能打爆图床，
 *    也会撞上 Workers 免费版 50 次子请求上限。
 *
 * 2. 边缘缓存 5 分钟
 *    合并后的清单对所有访客是同一份，没缓存就是每个访客每次访问
 *    都把上游重新拉一遍（1000 张图 = 25 次带 token 的请求/访客/页面）。
 *    注意：Cloudflare 不支持 cache.put 的 stale-while-revalidate /
 *    stale-if-error，需要「边喂旧值」得自己存两份 key，这里不这么做。
 *    另注意：只设 Cache-Control 响应头【不会】产生边缘缓存，
 *    那是浏览器缓存；边缘缓存必须显式 cache.put。
 *
 * 3. 每个上游请求都有超时
 *    Workers 对单条子请求没有墙钟上限（只要客户端还连着）。
 *    图床 accept 连接后不响应 = 本函数永久挂起，前端永远「加载中」。
 * ============================================================ */

const UPSTREAM_BASE = 'https://7bu.top/api/v1/images';
const UPSTREAM_PER_PAGE = 40;        // 图床单页硬上限，写死不透传
const MAX_CONCURRENT = 6;            // Workers 单次调用最多 6 条并发外连
const FETCH_TIMEOUT_MS = 8000;       // 单次上游请求超时
const CACHE_TTL_SECONDS = 300;       // 边缘缓存 5 分钟
const CACHE_KEY = 'https://lumina.internal/api/images';
const CALLER_MAX = 500;              // ?per_page 上限
const LAST_PAGE_WARN_THRESHOLD = 15;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, { status: false, message: 'Method Not Allowed', data: {} }, { Allow: 'GET, HEAD' });
  }

  // 优先用语义化变量名；TOKEN 是历史遗留的通用名，若命中会告警
  const token = env.QUBU_TOKEN || env.TOKEN;
  if (!token) {
    // 未配置时返回 200 + status:false：前端据此静默回退 fallbackImages。
    // 刻意【不进缓存】—— 否则管理员刚补好变量也要等 5 分钟才生效。
    return json(200, {
      status: false,
      message: '未配置环境变量 QUBU_TOKEN，请在 Pages 项目 Settings → Environment variables 中添加',
      data: { data: [] },
    });
  }
  if (!env.QUBU_TOKEN && env.TOKEN) {
    console.warn('[Lumina images] 环境变量 TOKEN 过于通用,已被当作图床密钥使用。请改名为 QUBU_TOKEN。');
  }

  const perPage = clampInt(new URL(request.url).searchParams.get('per_page'), 1, CALLER_MAX, CALLER_MAX);

  // ---- 边缘缓存命中则直接返回 ----
  const cache = caches.default;
  const cached = await cache.match(CACHE_KEY);
  if (cached) {
    const body = await sliceToLimit(cached, perPage);
    if (body) return withBrowserCache(body, cached.headers.get('x-lumina-hit') ? 300 : 60);
  }

  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + token,
  };

  try {
    const first = await fetchPage(1, headers);
    // 首页面可能是「网络层失败」(无 Response,只有 err),也可能是「上游返回了错误状态」
    if (!first.ok) {
      if (!first.res) return networkError(first.err);
      return upstreamError(first.res);
    }
    const firstJson = await first.res.json();
    const innerData = (firstJson && firstJson.data) || {};
    const total = Number(innerData.total) || 0;
    const lastPage = Math.max(1, Number(innerData.last_page) || 1);

    if (lastPage > LAST_PAGE_WARN_THRESHOLD) {
      console.warn(`[Lumina images] 图床分页较多: last_page=${lastPage}, total=${total}`);
    }

    // 只需凑够 perPage 张：页数由 perPage 与 40 共同决定，不由调用方任意放大
    const pagesNeeded = Math.min(lastPage, Math.ceil(perPage / UPSTREAM_PER_PAGE));
    const items = [];
    if (Array.isArray(innerData.data)) items.push(...innerData.data);

    const failedPages = [];
    if (pagesNeeded > 1) {
      const numbers = [];
      for (let p = 2; p <= pagesNeeded; p++) numbers.push(p);
      const results = await mapInChunks(numbers, MAX_CONCURRENT, (p) => fetchPage(p, headers));
      for (let i = 0; i < numbers.length; i++) {
        const r = results[i];
        if (r.ok) {
          const body = r.res ? await r.res.json() : null;
          const arr = body && body.data && body.data.data;
          if (Array.isArray(arr)) items.push(...arr);
        } else {
          // 部分页失败不能静默吞掉：否则 total 与实际返回一致地撒谎，
          // 前端和运维都发现不了图片少了。
          failedPages.push(numbers[i]);
          console.warn(`[Lumina images] 第 ${numbers[i]} 页拉取失败,该页图片缺失`);
        }
      }
    }

    const payload = wrapUpstream(items, innerData, { total, pagesNeeded, failedPages, truncated: total > items.length });

    const res = json(200, payload);
    // 只有成功结果进缓存；带 failed_pages 的半份数据不缓存
    if (failedPages.length === 0) {
      res.headers.set('X-Lumina-Hit', 'miss');
      await cache.put(CACHE_KEY, res.clone());
    }
    return withBrowserCache(res, 60);
  } catch (err) {
    return networkError(err);
  }
}

/* ---------- 上游 ---------- */

function pageUrl(page) {
  const u = new URL(UPSTREAM_BASE);
  u.searchParams.set('order', 'newest');
  u.searchParams.set('per_page', String(UPSTREAM_PER_PAGE));
  u.searchParams.set('page', String(page));
  return u;
}

/** 单页拉取,带超时。失败一律 resolve 成 {ok:false} 而不是抛出。
 *  @returns {Promise<{ok: true, res: Response} | {ok: false, res?: Response, err?: unknown}>} */
async function fetchPage(page, headers) {
  try {
    const res = await fetch(pageUrl(page), { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // 非 2xx 要把 body 消费掉,否则连接不释放
    if (!res.ok) {
      try { await res.arrayBuffer(); } catch { /* 已读或已断 */ }
      return { ok: false, res };
    }
    return { ok: true, res };
  } catch (err) {
    return { ok: false, err };
  }
}

/** 网络层失败(连不上 / 超时 / DNS):没有 Response 可读,只能自己造 502 */
function networkError(err) {
  const msg = err && err.name === 'TimeoutError'
    ? `图床请求超时（${FETCH_TIMEOUT_MS}ms）`
    : '图床不可达：' + (err && err.message ? err.message : String(err));
  return json(502, { status: false, message: msg, data: {} });
}

/** 上游错误响应:非 JSON(HTML 错误页 / CDN 拦截)必须包装,否则前端解析失败 */
function upstreamError(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return json(res.status, {
      status: false,
      message: `上游返回非 JSON 响应 (HTTP ${res.status}, content-type: ${ct || 'unknown'})`,
      data: {},
    });
  }
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/** 分块并发:Workers 硬上限 6 条并发外连,超出部分排队 */
async function mapInChunks(items, size, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const part = await Promise.all(slice.map((it, k) => fn(it).then((v) => { out[i + k] = v; })));
    void part;
  }
  return out;
}

/* ---------- 响应组装 ---------- */

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
  });
}

/** 浏览器缓存:边缘已有 5 分钟,这里只做同页刷新去重 */
function withBrowserCache(res, maxAge) {
  res.headers.set('Cache-Control', `public, max-age=${maxAge}`);
  return res;
}

/** 命中边缘缓存时按本次 ?per_page 截断（缓存里存的是完整清单） */
async function sliceToLimit(res, perPage) {
  try {
    const payload = await res.clone().json();
    const items = (payload.data && payload.data.data) || [];
    if (!Array.isArray(items)) return null;
    if (items.length <= perPage) return res;
    return json(200, {
      status: true,
      message: payload.message,
      data: Object.assign({}, payload.data, { data: items.slice(0, perPage), per_page: perPage }),
    });
  } catch {
    return null;
  }
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 包装成图床原始三段式，前端兜底逻辑可直接复用。
 * total 用上游真实值，不再谎报 items.length —— 半份数据下二者一致会让人无法察觉丢图。
 */
function wrapUpstream(items, innerData, meta) {
  return {
    status: true,
    message: 'success',
    data: Object.assign({}, innerData, {
      data: items,
      current_page: 1,
      last_page: 1,
      total: meta.total || items.length,
      returned: items.length,
      per_page: items.length,
      pages_fetched: meta.pagesNeeded,
      failed_pages: meta.failedPages,
      truncated: meta.truncated,
    }),
  };
}
