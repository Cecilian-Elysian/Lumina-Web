/* ============================================================
 * 流动图片墙 — 全局配置文件
 * ------------------------------------------------------------
 * ★★★ 这是你唯一需要修改的文件 ★★★
 *
 * 所有可变项（图床接口、token、行数、兜底图等）都集中在这里。
 * 修改后刷新页面即可生效，无需改动 main.js / style.css。
 *
 * ⚠⚠⚠ 安全警告 ⚠⚠⚠
 *  1. 本项目为纯前端站点，token 会被打包进公开的 JS 文件，
 *     任何访问者都能在浏览器中看到它。
 *  2. 因此【强烈建议】使用图床的【只读 / 低权限 token】，
 *     绝对不要使用具备上传、删除权限的主 token！
 *  3. 提交到 GitHub 之前，务必确认 token 是否愿意公开。
 * ============================================================ */

const CONFIG = {

  /* ------------------------------------------------------------
   * 〇、数据源模式（重要）
   * ------------------------------------------------------------
   *   'proxy'  → 【推荐】请求本站 /api/images 代理（functions/api/images.js）
   *              token 存放在 Cloudflare Pages 环境变量 QUBU_TOKEN，
   *              前端代码与 GitHub 仓库中【完全不含 token】，安全。
   *              本地开发需运行：npx wrangler pages dev .
   *   'direct' → 前端直连图床：填好下方 apiBase + token 即可。
   *              ⚠️ token 会暴露给所有访问者（写在公开 JS 里），
   *              仅建议调试时临时使用。
   * ---------------------------------------------------------- */
  mode: 'proxy',

  /* ------------------------------------------------------------
   * 一、图床接口配置（仅 direct 直连模式使用；proxy 模式忽略）
   * ------------------------------------------------------------
   * 直连模式时页面会请求 `apiBase + listPath` 拉取图片列表。
   * 如果 apiBase 或 token 留空，页面会直接使用下方
   * fallbackImages（兜底演示图），方便你先预览整体效果。
   * ---------------------------------------------------------- */

  // 图床 API 的根地址（不含接口路径）
  // 已实测：去不图床 7bu.top（CZL 同款程序），接口 /api/v1/images
  apiBase: 'https://7bu.top/api/v1',

  // 获取图片列表的接口路径（拼在 apiBase 后面）
  listPath: '/images',

  // 鉴权方式：
  //   'bearer' → 请求头带 Authorization: Bearer <token>（最常见）
  //   'header' → 请求头带自定义头（头名见 authKey，值前缀见 tokenPrefix）
  //   'none'   → 不带鉴权（公开接口）
  authType: 'bearer',

  // 当 authType = 'header' 时使用的请求头名称，例如 'X-API-Key'
  authKey: 'Authorization',

  // 当 authType = 'header' 时 token 前缀，例如 'Bearer '；bearer 模式忽略此项
  tokenPrefix: 'Bearer ',

  // ★ 仅 direct 直连模式需要填 token（会暴露给访问者！）
  // proxy 模式下请留空 —— token 请配置到：
  //   Cloudflare Pages → Settings → Environment variables → QUBU_TOKEN
  // 本地开发则在项目根目录 .dev.vars 文件写入：QUBU_TOKEN=你的token
  // （.dev.vars 已被 .gitignore 忽略，不会提交）
  token: '',

  /* ------------------------------------------------------------
   * 二、返回数据字段映射
   * ------------------------------------------------------------
   * 不同图床返回的 JSON 结构不同，这里用"点分路径"告诉
   * main.js 去哪里取数据，无需改代码即可适配大多数图床。
   * 支持嵌套路径（点分多级）。
   *
   * 当前配置为去不图床 7bu.top 的实际返回结构：
   *   {
   *     "status": true,
   *     "data": {
   *       "data": [
   *         {
   *           "origin_name": "146659727_p1.png",
   *           "links": {
   *             "url": "https://bu.dusays.com/...png",           ← 原图直链
   *             "thumbnail_url": "https://7bu.top/thumbnails/..." ← 缩略图
   *           }
   *         }
   *       ]
   *     }
   *   }
   * ---------------------------------------------------------- */

  // 图片数组在返回 JSON 中的路径（用 . 分隔层级）
  imgField: 'data.data',

  // 数组元素中"原图 URL"的字段路径（支持嵌套，灯箱大图用）
  imgUrlField: 'links.url',

  // 数组元素中"缩略图 URL"的字段路径（卡片小图用，加载快；
  // 留空 '' 或取不到时自动回退原图）
  imgThumbField: 'links.thumbnail_url',

  // 数组元素中"图片名称"的字段路径（灯箱底部会显示；没有则留 ''）
  imgNameField: 'origin_name',

  // 拉取数量：传到代理层的期望上限（实际由代理自动分页合并后返回全部）
  // 7bu.top 单页硬上限 40 张,代理内部并发拉 last_page 页后合并,前端无感
  perPage: 100,

  /* ------------------------------------------------------------
   * 七、图集配置(已迁移到 js/albums.js)
   * ------------------------------------------------------------
   * 图集(albums)数据不再保存在 config.js 中,改为:
   *   - 元数据(_meta: id + name)+ url → id 映射 全部存于 js/albums.js
   *   - 由本地 manager/(拖拽)或编辑器离线编辑,无需修改本文件
   * 旧字段 CONFIG.characters(角色允许表)已废弃,不再读取。
   *
   * 如果你还在用旧的 CONFIG.galleries 兜底,继续保留即可(向后兼容);
   * 但推荐用 js/albums.js 替换,体验更好。
   * ---------------------------------------------------------- */

  /* ------------------------------------------------------------
   * 三、图片墙布局
   * ---------------------------------------------------------- */

  // 叠层行数（3 = 三行，奇偶行自动反向流动；手机端会自动减行，见 css）
  rows: 3,

  // 每张卡片的图片宽度（px）。高度统一、宽度按此值等比
  cardWidth: 300,

  /* ------------------------------------------------------------
   * 四、兜底演示图（fallback）
   * ------------------------------------------------------------
   * 以下情况会使用这些图片：
   *   1. apiBase 或 token 留空（未配置图床）
   *   2. 接口请求失败（网络错误 / 401 鉴权失败 / 字段路径不匹配）
   *
   * 当前使用 picsum.photos 固定种子占位图（每次刷新不变）。
   * 你也可以换成自己的图片直链。
   * ---------------------------------------------------------- */
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

  /* ------------------------------------------------------------
   * 五、缩略图增强策略(让流动卡片更清晰)
   * ------------------------------------------------------------
   * 工作原理:
   *   thumbRewrite  → 改写 thumbnail_url,让图床返回更大尺寸
   *   thumbWidth    → 改写时使用的目标宽度
   *   srcset        → (main.js 自动生成)让 Retina 屏直接用原图 url
   *
   * thumbRewrite 可选值:
   *   null / ''                              → 不改写,使用图床返回的 thumbnail_url
   *   'query:w'                              → 追加 ?w=thumbWidth(7bu.top 常见支持)
   *   'query:size'                           → 追加 ?size=thumbWidth(部分 Chevereto)
   *   'replace:/thumbnails/::/images/'       → 路径替换(实测有效再填)
   *
   * 实测 7bu.top 不支持上述改写,默认 null,靠 srcset 让 Retina 屏选原图。
   * ---------------------------------------------------------- */
  thumbWidth: 600,
  thumbRewrite: null,
  lazyRootMargin: '200px',

  /* ------------------------------------------------------------
   * 六、相册列表（图集页使用，向后兼容）
   * ------------------------------------------------------------
   * 当前图集页优先使用 js/albums.js（由本地管理器拖拽维护）。
   * 本字段仅在 albums.js 数据完全为空、且需要展示历史 demo 相册时
   * 作为兜底显示。新增内容请优先维护 js/albums.js。
   *
   * 结构：每项 = 一个相册
   *   title       相册标题（必填，搜索/卡片显示）
   *   date        日期标签（卡片右下角胶囊）
   *   cover       封面图 URL（卡片主图）
   *   description 描述（搜索关键字，目前未做搜索，预留）
   *   images      相册内图片数组（点击卡片打开灯箱用）
   * ---------------------------------------------------------- */
  galleries: [
    {
      title: '德克萨斯',
      date: '2026-08-04',
      cover: 'https://bu.dusays.com/2026/08/07/6a7543c1b449f.jpg',
      description: '示例相册 · 德克萨斯',
      images: [
        'https://bu.dusays.com/2026/08/07/6a7543c1b449f.jpg',
        'https://bu.dusays.com/2026/08/07/6a7543c13d1ba.jpg',
        'https://bu.dusays.com/2026/08/07/6a7543c080d97.jpg',
      ],
    },
    {
      title: '星海拾光',
      date: '2026-07-12',
      cover: 'https://bu.dusays.com/2026/08/05/6a72df8a995d2.jpg',
      description: '示例相册 · 星海拾光',
      images: [
        'https://bu.dusays.com/2026/08/05/6a72df8a995d2.jpg',
        'https://bu.dusays.com/2026/08/05/6a72e1e316838.jpg',
      ],
    },
    {
      title: '夏日剪影',
      date: '2026-07-21',
      cover: 'https://bu.dusays.com/2026/08/04/6a71e68e7c675.jpg',
      description: '示例相册 · 夏日剪影',
      images: [
        'https://bu.dusays.com/2026/08/04/6a71e68e7c675.jpg',
        'https://bu.dusays.com/2026/08/04/6a71cd89ebd59.jpg',
        'https://bu.dusays.com/2026/08/04/6a71ed5d3acdd.jpg',
        'https://bu.dusays.com/2026/08/04/6a71e67ca957f.jpg',
      ],
    },
    {
      title: '夜行列车',
      date: '2026-06-30',
      cover: 'https://bu.dusays.com/2026/08/07/6a7543be8af5f.jpg',
      description: '示例相册 · 夜行列车',
      images: [
        'https://bu.dusays.com/2026/08/07/6a7543be8af5f.jpg',
        'https://bu.dusays.com/2026/08/07/6a7543b4e47a6.jpg',
      ],
    },
    {
      title: '云端日记',
      date: '2026-06-15',
      cover: 'https://bu.dusays.com/2026/08/07/6a7543b142698.jpg',
      description: '示例相册 · 云端日记',
      images: [
        'https://bu.dusays.com/2026/08/07/6a7543b142698.jpg',
        'https://bu.dusays.com/2026/08/07/6a7543aec18c9.jpg',
        'https://bu.dusays.com/2026/08/07/6a7543aec93d3.jpg',
      ],
    },
    {
      title: '灯下漫笔',
      date: '2026-05-28',
      cover: 'https://bu.dusays.com/2026/08/26/6a8e4886824f2.png',
      description: '示例相册 · 灯下漫笔',
      images: [
        'https://bu.dusays.com/2026/08/26/6a8e4886824f2.png',
        'https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg',
      ],
    },
  ],
};
