/* ============================================================
 * Lumina — 全局配置(纯字面量数据)
 * ------------------------------------------------------------
 * ★ 本文件同时被两方读取:
 *   1. Vite(src/site/composables.ts 等) — 直接 import
 *   2. tools/server(本地 Manager) — 用 acorn 静态解析
 *
 * ★ 因此本文件必须保持「纯字面量」:
 *   - 禁止 import / 类型注解 / as const / 模板字符串
 *   - 只允许 Object / Array / string / number / boolean / null
 *   - acorn 以 sourceType: 'module' 解析,支持 export const
 *
 * ⚠ 安全:token 仅在 direct 调试模式下填写(会暴露给访问者);
 *   proxy 模式下留空,token 存于 Cloudflare 环境变量 QUBU_TOKEN。
 * ============================================================ */
export const CONFIG = {
  /* ---- 数据源模式 ----
   * 'proxy'  → 请求本站 /api/images 代理(token 在服务端,推荐)
   * 'direct' → 前端直连图床(token 写在下方,仅调试用) */
  mode: 'proxy',

  /* ---- 关闭图床 API(完全跳过 /api/images 与图床请求) ----
   * true  → 直接用 fallbackImages,不发任何网络请求,
   *          不弹 banner、不打 console.warn。
   * 适合不想配 QUBU_TOKEN、只想展示兜底图的场景。
   * 配好 token 后改回 false 即可恢复。 */
  apiDisabled: false,

  /* ---- 上游图床接口(仅 direct 模式使用) ---- */
  apiBase: 'https://7bu.top/api/v1',
  listPath: '/images',
  authType: 'bearer',
  authKey: 'Authorization',
  tokenPrefix: 'Bearer ',
  token: '',

  /* ---- 返回数据字段映射(点分路径) ---- */
  imgField: 'data.data',
  imgUrlField: 'links.url',
  imgThumbField: 'links.thumbnail_url',
  imgNameField: 'origin_name',

  /* 拉取数量上限(代理内部自动分页合并,前端无感) */
  perPage: 100,

  /* ---- 图片墙布局 ---- */
  rows: 3,
  cardWidth: 300,

  /* ---- 缩略图增强(实测 7bu.top 不支持改写,保持 null) ---- */
  thumbWidth: 600,
  thumbRewrite: null,
  lazyRootMargin: '200px',

  /* ---- 兜底演示图(上游不可达时使用) ---- */
  fallbackImages: [
    'https://bu.dusays.com/2026/08/26/6a8e4886824f2.png',
    'https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543c1b449f.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543c13d1ba.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543c080d97.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543be8af5f.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543b4e47a6.jpg',
    'https://bu.dusays.com/2026/08/05/6a72df8a995d2.jpg',
    'https://bu.dusays.com/2026/08/04/6a71e68e7c675.jpg',
    'https://bu.dusays.com/2026/08/04/6a71cd89ebd59.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543b142698.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543aec18c9.jpg',
    'https://bu.dusays.com/2026/08/07/6a7543aec93d3.jpg',
    'https://bu.dusays.com/2026/08/05/6a72e1e316838.jpg',
    'https://bu.dusays.com/2026/08/04/6a71ed5d3acdd.jpg',
    'https://bu.dusays.com/2026/08/04/6a71e67ca957f.jpg',
  ],
};
