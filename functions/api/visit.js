/* ============================================================
 * Cloudflare Pages Function — 访客统计
 * ------------------------------------------------------------
 * 路由:/api/visit(目录即路由:functions/api/visit.js)
 *
 *   POST  记一次访问(前端页面加载时调用,无 body)
 *   GET   返回累计统计(页脚胶囊用,公开)
 *         → { status: true, data: { pv, uv, today: { pv, uv } } }
 *
 * 隐私设计:
 *   UV 去重键 vid = sha256(CF-Connecting-IP + User-Agent + day),
 *   按日轮转,不落原始 IP / 不设跨日追踪;数据库里只有哈希。
 *
 * 降级策略:
 *   未绑定 D1(env.DB 缺失)→ 返回 200 + status:false + 全 0,
 *   前端据此隐藏统计段,不报错不打扰。
 *
 * 初始化 D1:
 *   npx wrangler d1 create lumina-db → id 填入 wrangler.toml
 *   npx wrangler d1 execute lumina-db --remote --file schema.sql
 * 站长查明细(无网页端,走 CLI):
 *   npx wrangler d1 execute lumina-db --remote --command "SELECT * FROM daily_stats"
 * ============================================================ */

/** 明显爬虫 UA 直接跳过,不写库 */
const BOT_UA_RE = /(bot|crawl|spider|slurp|headless|phantom|preview)/i;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') return recordVisit(request, env);
  if (request.method === 'GET') return totals(env);
  return json(405, { status: false, message: 'Method Not Allowed', data: {} });
}

/* ---------- POST:记一次访问 ---------- */
async function recordVisit(request, env) {
  const db = env.DB;
  if (!db) return json(200, { status: false, message: '未绑定 D1 数据库', data: {} });

  const ua = request.headers.get('User-Agent') || '';
  // 机器人也返回真实累计:前端拿到 {skipped:true} 时若也照单全收,
  // 会把页脚统计清零显示成「0 次照亮 · 0 位旅人」。这里多查一次 D1 换正确显示。
  if (BOT_UA_RE.test(ua)) {
    const t = await totals(env);
    const payload = await t.json();
    return json(200, { status: true, data: Object.assign({ skipped: true }, payload.data) });
  }

  // UTC 日期(与 sha256 里的 day 同源,跨日边界一致性优先于本地时区)
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const vid = await sha256hex(ip + '\n' + ua + '\n' + day);

  try {
    // 一次 db.batch 完成「写指纹 + 更新聚合计数」:
    //   - batch 是事务,任一语句失败整批回滚。原实现是 3 次独立往返,
    //     中间失败会留下「指纹已写入但计数没加」的状态 —— 该访客当天
    //     永远不会再被算作新访客,UV 永久丢失。
    //   - UV 增量用 changes() 取上一条语句的行数(changes() 在本语句
    //     的 VALUES 求值阶段执行,读到的是上一条语句的结果)。
    //     excluded.uv 是本行「本该插入」的值,供 ON CONFLICT 分支复用。
    //     此语义已用真 SQLite(node:sqlite)验证,见 tools/test/visit-sql.test.mjs。
    await db.batch([
      db.prepare('INSERT INTO visitors (day, vid) VALUES (?1, ?2) ON CONFLICT (day, vid) DO NOTHING')
        .bind(day, vid),
      db.prepare(
        'INSERT INTO daily_stats (day, pv, uv) VALUES (?1, 1, (SELECT changes())) ' +
        'ON CONFLICT (day) DO UPDATE SET pv = daily_stats.pv + 1, uv = daily_stats.uv + excluded.uv'
      ).bind(day),
    ]);

    return totals(env);
  } catch (err) {
    return json(500, { status: false, message: '统计写入失败:' + errMsg(err), data: {} });
  }
}

/* ---------- GET:累计 + 今日 ---------- */
async function totals(env) {
  const empty = { pv: 0, uv: 0, today: { pv: 0, uv: 0 } };
  const db = env.DB;
  if (!db) return json(200, { status: false, message: '未绑定 D1 数据库', data: empty });

  try {
    const day = new Date().toISOString().slice(0, 10);
    const [sum, todayRow] = await db.batch([
      db.prepare('SELECT COALESCE(SUM(pv), 0) AS pv, COALESCE(SUM(uv), 0) AS uv FROM daily_stats'),
      db.prepare('SELECT pv, uv FROM daily_stats WHERE day = ?1').bind(day),
    ]);
    const s = (sum.results && sum.results[0]) || {};
    const t = (todayRow.results && todayRow.results[0]) || {};
    return json(200, {
      status: true,
      data: {
        pv: num(s.pv),
        uv: num(s.uv),
        today: { pv: num(t.pv), uv: num(t.uv) },
      },
    });
  } catch (err) {
    return json(500, { status: false, message: '统计读取失败:' + errMsg(err), data: empty });
  }
}

/* ---------- 小工具 ---------- */
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}

/** sha256 → 小写 hex(Workers WebCrypto 同步可用) */
async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
