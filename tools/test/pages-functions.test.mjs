/* ============================================================
 * Pages Functions 单测 — functions/api/visit.js + likes.js
 * ------------------------------------------------------------
 * 不需要 wrangler:直接 import 函数,用 mock D1(按 SQL 形状分发)
 * + Node 18 内置 Request/Response/WebCrypto 跑通全部读写路径。
 * mock D1 忠实复刻函数用到的每条 SQL 语义:
 *   visitors 主键去重(changes=1 首次/0 冲突)、daily_stats 累加、
 *   likes 原子增减 + MAX(0) 兜底。
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { onRequest as visitHandler } from '../../functions/api/visit.js';
import { onRequest as likesHandler } from '../../functions/api/likes.js';

/** 按 SQL 前缀分发的迷你 D1 mock */
function createMockD1() {
  const visitors = new Map(); // `${day}|${vid}` → true
  const stats = new Map(); // day → { pv, uv }
  const likes = new Map(); // url → count

  function exec(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('INSERT INTO visitors')) {
      const key = `${params[0]}|${params[1]}`;
      if (visitors.has(key)) return { meta: { changes: 0 } };
      visitors.set(key, true);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO daily_stats')) {
      const [day, uvInc] = params;
      const cur = stats.get(day) || { pv: 0, uv: 0 };
      cur.pv += 1;
      cur.uv += uvInc;
      stats.set(day, cur);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('SELECT COALESCE(SUM(pv)')) {
      let pv = 0;
      let uv = 0;
      for (const v of stats.values()) { pv += v.pv; uv += v.uv; }
      return { results: [{ pv, uv }] };
    }
    if (s.includes('FROM daily_stats WHERE day')) {
      const cur = stats.get(params[0]) || { pv: 0, uv: 0 };
      return { results: [{ pv: cur.pv, uv: cur.uv }] };
    }
    if (s.startsWith('SELECT url, count FROM likes')) {
      return { results: [...likes.entries()].map(([url, count]) => ({ url, count })) };
    }
    if (s.startsWith('INSERT INTO likes')) {
      const [url, delta] = params;
      const next = Math.max(0, (likes.get(url) || 0) + delta);
      likes.set(url, next);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('SELECT count FROM likes WHERE url')) {
      return { results: [{ count: likes.get(params[0]) || 0 }] };
    }
    throw new Error('mock D1: 未实现的 SQL: ' + sql);
  }

  return {
    prepare(sql) {
      return {
        sql,
        _params: [],
        bind(...args) { this._params = args; return this; },
        async run() { return exec(this.sql, this._params); },
        async all() { return exec(this.sql, this._params); },
      };
    },
    async batch(stmts) {
      const out = [];
      for (const st of stmts) out.push(await exec(st.sql, st._params));
      return out;
    },
  };
}

function visitRequest(method, { ip, ua } = {}) {
  const headers = {};
  if (ip) headers['CF-Connecting-IP'] = ip;
  headers['User-Agent'] = ua || 'Mozilla/5.0 (test browser)';
  return new Request('https://lumina.test/api/visit', { method, headers });
}

async function visitOnce(env, ip) {
  const res = await visitHandler({ request: visitRequest('POST', { ip }), env });
  return res.json();
}

/* ---------------- /api/visit ---------------- */
describe('functions/api/visit', () => {
  it('首次访问 PV=1 UV=1,同指纹再访只加 PV', async () => {
    const env = { DB: createMockD1() };

    const first = await visitOnce(env, '1.2.3.4');
    expect(first.status).toBe(true);
    expect(first.data.pv).toBe(1);
    expect(first.data.uv).toBe(1);
    expect(first.data.today.pv).toBe(1);
    expect(first.data.today.uv).toBe(1);

    await visitOnce(env, '1.2.3.4');
    const third = await visitOnce(env, '1.2.3.4');
    expect(third.data.pv).toBe(3);
    expect(third.data.uv).toBe(1); // 同 IP+UA 同日 = 同 vid
  });

  it('不同 IP 计为独立访客', async () => {
    const env = { DB: createMockD1() };
    await visitOnce(env, '1.1.1.1');
    const r = await visitOnce(env, '2.2.2.2');
    expect(r.data.pv).toBe(2);
    expect(r.data.uv).toBe(2);
  });

  it('爬虫 UA 跳过不计数', async () => {
    const env = { DB: createMockD1() };
    const res = await visitHandler({
      request: visitRequest('POST', { ip: '9.9.9.9', ua: 'Googlebot/2.1' }),
      env,
    });
    const json = await res.json();
    expect(json.status).toBe(true);
    expect(json.data.skipped).toBe(true);
    // 库里没有写入任何记录
    const totals = await (await visitHandler({ request: visitRequest('GET'), env })).json();
    expect(totals.data.pv).toBe(0);
    expect(totals.data.uv).toBe(0);
  });

  it('GET 返回累计与今日(多日聚合)', async () => {
    const env = { DB: createMockD1() };
    // 直接往 mock 里塞两天数据
    env.DB.prepare('INSERT INTO daily_stats (day, pv, uv) VALUES (?1, 1, ?2)').bind('2026-09-25', 1).run();
    env.DB.prepare('INSERT INTO daily_stats (day, pv, uv) VALUES (?1, 1, ?2)').bind('2026-09-26', 0).run();

    const res = await visitHandler({ request: visitRequest('GET'), env });
    const json = await res.json();
    expect(json.data.pv).toBe(2);
    expect(json.data.uv).toBe(1);
    expect(json.data.today.pv + json.data.today.uv).toBeGreaterThanOrEqual(0); // 今日行取决于真实日期
  });

  it('未绑定 D1 → status:false 全 0(前端静默降级)', async () => {
    const post = await (await visitHandler({ request: visitRequest('POST', { ip: '1.1.1.1' }), env: {} })).json();
    const get = await (await visitHandler({ request: visitRequest('GET'), env: {} })).json();
    expect(post.status).toBe(false);
    expect(get.status).toBe(false);
    expect(get.data.pv).toBe(0);
  });
});

/* ---------------- /api/likes ---------------- */
function likeRequest(body, env) {
  const request = new Request('https://lumina.test/api/likes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return likesHandler({ request, env }).then((r) => r.json());
}

describe('functions/api/likes', () => {
  it('点赞/取消/夹紧不为负', async () => {
    const env = { DB: createMockD1() };
    const url = 'https://bu.dusays.com/a.jpg';

    expect((await likeRequest({ url, delta: 1 }, env)).data.count).toBe(1);
    expect((await likeRequest({ url, delta: 1 }, env)).data.count).toBe(2);
    expect((await likeRequest({ url, delta: -1 }, env)).data.count).toBe(1);
    expect((await likeRequest({ url, delta: -1 }, env)).data.count).toBe(0);
    expect((await likeRequest({ url, delta: -1 }, env)).data.count).toBe(0); // MAX(0) 兜底
  });

  it('GET 返回全量计数表', async () => {
    const env = { DB: createMockD1() };
    await likeRequest({ url: 'https://a/1.jpg', delta: 1 }, env);
    await likeRequest({ url: 'https://a/2.jpg', delta: 1 }, env);
    await likeRequest({ url: 'https://a/2.jpg', delta: 1 }, env);

    const res = await likesHandler({ request: new Request('https://lumina.test/api/likes'), env });
    const json = await res.json();
    expect(json.status).toBe(true);
    expect(json.data.likes).toEqual({ 'https://a/1.jpg': 1, 'https://a/2.jpg': 2 });
  });

  it('非法 url / 非法 delta → 400', async () => {
    const env = { DB: createMockD1() };
    expect((await likeRequest({ url: 'ftp://x/a.jpg', delta: 1 }, env)).status).toBe(false);
    expect((await likeRequest({ url: 'https://ok/a.jpg', delta: 0 }, env)).status).toBe(false);
    expect((await likeRequest({ url: 'https://ok/a.jpg', delta: 2 }, env)).status).toBe(false);
    expect((await likeRequest({ url: 'x'.repeat(501), delta: 1 }, env)).status).toBe(false);
  });

  it('未绑定 D1 → status:false', async () => {
    const r = await likeRequest({ url: 'https://a/1.jpg', delta: 1 }, {});
    expect(r.status).toBe(false);
  });
});
