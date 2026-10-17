/* ============================================================
 * Cloudflare Pages Function — 图片点赞
 * ------------------------------------------------------------
 * 路由:/api/likes
 *
 *   GET    全量计数 → { status: true, data: { likes: { [url]: count } } }
 *          (几十到几百张图一次查完,前端启动拉一次)
 *   POST   { url, delta } 增减计数(delta 仅接受 1 / -1)
 *          → { status: true, data: { url, count } } 返回权威计数
 *
/* 去重策略:访客本地(localStorage lumina.liked)去重,服务端只做
 * 原子计数;取消点赞 delta=-1 且 MAX(0,…) 兜底不为负。
 *
 * 输入校验三层:必须 application/json(阻断跨站 <form> 简单请求伪造)、
 * url 仅接受白名单 host 的 http(s) 直链且长度 ≤ 500、delta 仅 ±1。
 *
 * 降级:未绑定 D1 → GET 返回空表(status:false),前端隐藏点赞 UI。
 * ============================================================ */

const URL_MAX_LEN = 500;
/** 允许计数的外链 host。换图床时改这里,或用环境变量 LIKE_ALLOWED_HOSTS 覆盖。 */
const DEFAULT_ALLOWED_HOSTS = ['bu.dusays.com'];

function allowedHosts(env) {
  const raw = env.LIKE_ALLOWED_HOSTS;
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method === 'GET') return listAll(db);
  if (request.method === 'POST') return like(request, db, env);
  return json(405, { status: false, message: 'Method Not Allowed', data: {} }, { Allow: 'GET, POST' });
}

/* ---------- GET:全量计数 ---------- */
async function listAll(db) {
  if (!db) return json(200, { status: false, message: '未绑定 D1 数据库', data: { likes: {} } });
  try {
    const { results } = await db.prepare('SELECT url, count FROM likes').all();
    const likes = {};
    for (const row of results || []) {
      if (typeof row.url === 'string') likes[row.url] = num(row.count);
    }
    // 计数变化很慢,给浏览器 30s 缓存(注意:这只是浏览器缓存,
    // 边缘缓存需显式 cache.put —— 见 images.js)
    return json(200, { status: true, data: { likes } }, { 'Cache-Control': 'public, max-age=30' });
  } catch (err) {
    return json(500, { status: false, message: '点赞读取失败:' + errMsg(err), data: { likes: {} } });
  }
}

/* ---------- POST:增减计数 ---------- */
async function like(request, db, env) {
  if (!db) return json(200, { status: false, message: '未绑定 D1 数据库', data: {} });

  // 必须 application/json:<form enctype="text/plain"> 发的是简单请求
  // (无预检),request.json() 仍会解析成功 → 不校验就能被任意网站伪造点赞
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  if (!ctype.includes('application/json')) {
    return json(415, { status: false, message: 'Content-Type 必须为 application/json', data: {} });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { status: false, message: '请求体必须是 JSON', data: {} });
  }
  // JSON 里的 null / 数组 / 数字都能解析成功,取属性前必须判对象
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { status: false, message: '请求体必须是 JSON 对象', data: {} });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const delta = num(body.delta);
  if (!/^https?:\/\//.test(url) || url.length > URL_MAX_LEN) {
    return json(400, { status: false, message: '非法图片地址', data: {} });
  }
  // 白名单 host:挡住任意 url 的垃圾行(无上限写入会耗尽 D1 写入配额)
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* 交给下面的 400 */ }
  if (!hostname || !allowedHosts(env).includes(hostname)) {
    return json(400, { status: false, message: '图片地址不在允许的域名内', data: {} });
  }
  if (delta !== 1 && delta !== -1) {
    return json(400, { status: false, message: 'delta 仅接受 1 或 -1', data: {} });
  }

  try {
    // batch 顺序执行:upsert(MAX 兜底负数) → 回读权威计数
    const [upsert, readback] = await db.batch([
      db.prepare(
        'INSERT INTO likes (url, count) VALUES (?1, MAX(0, ?2)) ' +
        'ON CONFLICT (url) DO UPDATE SET count = MAX(0, likes.count + ?2)'
      ).bind(url, delta),
      db.prepare('SELECT count FROM likes WHERE url = ?1').bind(url),
    ]);
    const count = num(readback.results && readback.results[0] && readback.results[0].count);
    return json(200, { status: true, data: { url, count } });
  } catch (err) {
    return json(500, { status: false, message: '点赞写入失败:' + errMsg(err), data: {} });
  }
}

/* ---------- 小工具 ---------- */
function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}
