/* ============================================================
 * Cloudflare Pages Function — 图床 API 代理
 * ------------------------------------------------------------
 * 路由：/api/images（目录即路由：functions/api/images.js）
 *
 * 作用（安全核心）：
 *   浏览器 → 本函数（无 token） → 7bu.top 图床 API（注入 token）
 *
 *   token 存放在 Cloudflare Pages 的【环境变量 QUBU_TOKEN】中，
 *   只在服务端（边缘节点）读取，永远不会出现在：
 *     - 前端 JS 代码 / GitHub 仓库
 *     - 浏览器网络请求 / 页面源码
 *
 * 配置环境变量的两种方式：
 *   A. Dashboard：Pages 项目 → Settings → Environment variables
 *      → 添加 QUBU_TOKEN（Production 和 Preview 都要加）
 *   B. CLI：npx wrangler pages secret put QUBU_TOKEN --project-name=<项目名>
 *
 * 本地开发（wrangler pages dev）：
 *   在项目根目录建 .dev.vars 文件写入 QUBU_TOKEN=xxx
 *   （.dev.vars 已加入 .gitignore，绝不会被提交）
 *
 * 分页合并：
 *   7bu.top 图床单页最多 40 张。本函数自动并发拉全部页（page=1..last_page），
 *   合并 data.data[] 数组后透传给浏览器，前端无需分页处理。
 * ============================================================ */

const UPSTREAM_BASE = 'https://7bu.top/api/v1/images';
const PER_PAGE_HARD_MAX = 40; // 图床单页硬上限,超过会被截断

// Pages Functions 约定导出：onRequest 处理所有方法的请求
export async function onRequest(context) {
  // context.env —— 环境变量（含 Dashboard/CLI 配置的 Secrets）
  // context.request —— 原始请求
  const { request, env } = context;

  // 读取密钥；未配置时返回明确的错误提示，方便部署排错
  const token = env.QUBU_TOKEN;
  if (!token) {
    return json(500, {
      status: false,
      message: '未配置环境变量 QUBU_TOKEN，请在 Pages 项目 Settings → Environment variables 中添加',
      data: {},
    });
  }

  /* ---- 构造对图床上游的请求 ----
   * 只透传安全的查询参数（per_page / order），
   * 防止调用者通过代理滥用图床的其他接口参数 */
  const perPage = clampInt(new URL(request.url).searchParams.get('per_page'), 1, 100, 60);
  // 图床硬上限 40,即使 caller 要 100,内部每次最多请求 40
  const requestPerPage = Math.min(PER_PAGE_HARD_MAX, perPage);

  const upstreamHeaders = {
    Accept: 'application/json',
    // ★ 安全关键：token 只在这里注入（服务端），前端永远看不到
    Authorization: 'Bearer ' + token,
  };

  try {
    // 第 1 页:探测 last_page / total
    const firstPage = 1;
    const firstUrl = new URL(UPSTREAM_BASE);
    firstUrl.searchParams.set('order', 'newest');
    firstUrl.searchParams.set('per_page', String(requestPerPage));
    firstUrl.searchParams.set('page', String(firstPage));

    const firstRes = await fetch(firstUrl, { headers: upstreamHeaders });
    if (!firstRes.ok) {
      // 透传 4xx/5xx 状态码,便于排查
      return new Response(firstRes.body, {
        status: firstRes.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const firstJson = await firstRes.json();
    const innerData = (firstJson && firstJson.data) || {};
    const items = Array.isArray(innerData.data) ? innerData.data.slice() : [];
    const total = Number(innerData.total) || items.length;
    const lastPage = Number(innerData.last_page) || 1;

    // 单页就能装下 → 包装成图床原始三段式返回
    if (lastPage <= 1) {
      return json(200, wrapUpstream(items, innerData));
    }

    // 多页:并发拉剩余页 (page=2..lastPage)
    const pageFetches = [];
    for (let p = 2; p <= lastPage; p++) {
      const u = new URL(UPSTREAM_BASE);
      u.searchParams.set('order', 'newest');
      u.searchParams.set('per_page', String(requestPerPage));
      u.searchParams.set('page', String(p));
      pageFetches.push(
        fetch(u, { headers: upstreamHeaders })
          .then((r) => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }
    const morePages = await Promise.all(pageFetches);
    for (const pg of morePages) {
      const moreItems = pg && pg.data && pg.data.data;
      if (Array.isArray(moreItems)) items.push(...moreItems);
    }

    return json(200, wrapUpstream(items, innerData));
  } catch (err) {
    // 图床不可达 / 超时等网络异常
    return json(502, {
      status: false,
      message: '图床请求失败：' + (err && err.message ? err.message : String(err)),
      data: {},
    });
  }
}

/* ---------- 小工具 ---------- */

/**
 * 构造 JSON 响应（统一与图床一致的三段式结构，前端兜底逻辑可直接复用）
 */
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * 把参数限制在 [min, max] 区间内的整数（非法/越界时用默认值）
 * 防止恶意传参（如 per_page=999999）打到图床
 */
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 包装成图床原始三段式: {status, message, data: {data: items, current_page, last_page, total}}
 * 保留 innerData 中的其他字段(如有),仅覆盖 data 数组相关字段。
 */
function wrapUpstream(items, innerData) {
  return {
    status: true,
    message: 'success',
    data: Object.assign({}, innerData, {
      data: items,
      current_page: 1,
      last_page: 1,
      total: items.length,
      per_page: items.length,
    }),
  };
}