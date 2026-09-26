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
  if (BOT_UA_RE.test(ua)) return json(200, { status: true, data: { skipped: true } });

  // UTC 日期(与 sha256 里的 day 同源,跨日边界一致性优先于本地时区)
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const vid = await sha256hex(ip + '\n' + ua + '\n' + day);

  try {
    // 1) 今日指纹首次出现 → changes=1 → UV +1,否则只加 PV
    const inserted = await db
      .prepare('INSERT INTO visitors (day, vid) VALUES (?1, ?2) ON CONFLICT (day, vid) DO NOTHING')
      .bind(day, vid)
      .run();
    const isNew = (inserted.meta && inserted.meta.changes) === 1;

    // 2) 聚合表 upsert:PV 恒 +1,UV 仅新访客 +1
    await db
      .prepare(
        'INSERT INTO daily_stats (day, pv, uv) VALUES (?1, 1, ?2) ' +
        'ON CONFLICT (day) DO UPDATE SET pv = pv + 1, uv = uv + ?2'
      )
      .bind(day, isNew ? 1 : 0)
      .run();

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
