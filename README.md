# Lumina-Web · 流动图片墙

Vue 3 + Vite + TypeScript 静态站点：多行叠层流动图片墙 + 图集浏览页 + 本地 Manager 编辑器
图床 token 存在 Cloudflare 环境变量，仓库与前端代码零暴露

## 开始

```bash
npm install

# 方式一（推荐，带代理看真实图床数据）：
npm run build
npx wrangler pages dev dist --port 8001

# 方式二（Vite 开发服务器，无代理 → 回退兜底图）：
npm run dev
```

> 代理模式需在 .dev.vars 写入 QUBU_TOKEN=你的token

## 页面

- index.html — 主页（流动图片墙）
- gallery.html — 图集页（相册网格 + 瀑布流）
- settings.html — 访客偏好设置
- 404.html — Cloudflare 404 页
- manager.html — 本地 Manager 编辑器（不部署）

## 部署

**Cloudflare Pages（Git 集成）**，Dashboard → Pages → Settings：

1. Builds：Build command `npm run build`，输出目录 `dist`（Git 集成会忽略 wrangler.toml 的构建配置，必须手动设）
2. 环境变量（Production / Preview 都填）：`NODE_VERSION=20`、`TOKEN`（Secret，7bu.top token）

推 main 自动部署。备选：CLI `npx wrangler pages deploy dist`，或仓库自带的 GitHub Actions（配 `CLOUDFLARE_API_TOKEN` 即可）。

验证：`curl -I https://illusium.pages.dev/assets/main-*.js` 应 200 且为 JS MIME。

### D1（访客统计 + 图片点赞）

未配置时页面静默降级（不显示统计/点赞，不报错）：

```bash
npx wrangler d1 create lumina-db   # 把输出的 id 填入 wrangler.toml
npm run db:schema:remote           # 建表（本地开发用 db:schema:local）
```

查明细：`npx wrangler d1 execute lumina-db --remote --command "SELECT * FROM daily_stats"`

## 注意事项

- 图床代理会并发拉全部分页，图床图片建议控制在 400 张以内
- Manager「配置」Tab 保存会整体重写 config.ts，手工注释会丢失；mode/token 不可改
- 统计/点赞接口无鉴权，个人站可接受；UV 按 `sha256(IP+UA+日)` 按日轮转，不存原始 IP
- AI 焦点分析是 merge 不是覆盖，不会清掉手工标注的焦点

## 本地 Manager

- Windows：双击 `tools/dev.bat`（一键装依赖 + 启动 + 开浏览器）；`tools/console.bat` 新开标签
- macOS / Linux：`./tools/start.sh`
- 监听 `127.0.0.1:8002`，详见 `tools/README.md`

## 文件结构

```
src/shared      前后端共享：types / utils / apiClient
src/site        Viewer 站点：视图组件 + likes/visit/settings/wallTouch 单例模块 + 样式
src/manager     本地 Manager 编辑器（焦点 / 图集 / 标签 / 配置 四个 Tab）
functions/api   Pages Functions：images 图床代理 / visit 访客统计 / likes 点赞
tools/          本地启动器 + AI 工具 + node 侧测试
schema.sql      D1 表结构（daily_stats / visitors / likes）
```

---

## 功能设计

- [x] 主页搭建
- [x] 图集搭建
- [x] 图集页(用户手动图集)+ 本地管理器拖拽
- [x] 焦点编辑器 + AI 焦点识别
- [x] 标签系统(Manager 打标签 → 图集页标签搜索 / 灯箱标签)
- [x] 设置页(访客偏好:主题/行数/宽度/速度/动画,localStorage)
- [x] 深色/浅色主题切换(设置页深/浅两档,防闪烁,CSS 变量组)
- [x] SEO 基建(OG 分享卡片/canonical/sitemap/robots,404 noindex)
- [x] 展示增强(灯箱缩放/平移/下载、「全部」瀑布流视图)
- [x] 触屏手动(流动墙拖拽/双击暂停/惯性,灯箱滑动切图/pinch 缩放/双击放大)
- [x] 图片点赞(灯箱 ♥ + 瀑布流角标,本地去重 + D1 原子计数,失败回滚)
- [x] 访客统计(页脚胶囊 PV/UV + 悬浮今日数据,D1 按日聚合,爬虫跳过)
- [ ] 设置搭建(站长端深水区:数据源切换 UI)

## 日志记录

- 2026-09-26 (v4) 触屏手动 + 图片点赞 + 访客统计。**触屏手动**:`wallTouch.ts` 纯函数(位移按轨道宽 50% 周期归一化/末段速度估算/点按判定/惯性衰减);`HomeView` 行内加 `.row-drag` 承接手动位移与 CSS 动画叠加,touch 指针按下暂停该行、横向拖动拨墙(带惯性)、双击持久暂停/继续、单击仍开灯箱(触屏延迟 280ms 给双击让路,拖拽后抑制合成 click);`:hover` 暂停限定 `@media (hover: hover)` 根治触屏粘滞,`.row` 加 `touch-action: pan-y` 保纵向滚动。**灯箱手势**:统一指针模型——1 指 scale=1 滑动切图(60px 阈值/快速轻扫,跟手弹回)、1 指 scale>1 平移、双指 pinch 缩放(1–4 倍,双指中心跟随)、手动双击检测(iOS 不合成 dblclick,且抑制原生重复触发)。**图片点赞**:D1 `likes` 表(url=原图直链,`MAX(0,…)` 防负数);`functions/api/likes.js` GET 全量/POST 原子增减;`site/likes.ts` 单例(localStorage `lumina.liked` 本地去重 + 乐观更新 + 失败回滚弹 banner + pending 防连点),UI 为灯箱 ♥ 胶囊按钮与瀑布流角标(未就绪不渲染)。**访客统计**:D1 `daily_stats`(按日 PV/UV)+ `visitors` 指纹表(按日轮转,不存原始 IP);`functions/api/visit.js` POST 记访问同响应返回累计(省一次 GET,爬虫 UA 跳过);`site/visit.ts` 单例;页脚改为**玻璃胶囊**(GitHub + 「N 次照亮 · M 位旅人」),悬浮显示今日数据。**基建**:`schema.sql` + wrangler.toml D1 绑定 + `db:schema:local/remote` 脚本;Function 有单测(`tools/test/pages-functions.test.mjs`,mock D1,无需 wrangler)。测试:根目录 77 项 + tools 72 项全过。
- 2026-09-25 (v3) 浅色主题观感微调。styles.css 再收敛 5 个阴影变量(`--nav-shadow/--title-shadow/--nav-link-shadow/--hover-shadow/--hover-shadow-sm`)替换 7 处硬编码黑色投影,浅色组下柔化为暗蓝灰低透明或 none(标题/导航 text-shadow 去除,hover 阴影降密);深色取值与原值一致像素级不变,灯箱恒暗部分与 toggle 旋钮投影不动。
- 2026-09-25 (v2) SEO 基建。index/gallery/settings 三页 `<head>` 加 `og:type/site_name/title/description/url/image/image:alt` + `twitter:card`(设置页 summary,其余 summary_large_image) + `canonical`(域名 illusium.pages.dev);og:image 用图床直链(`bu.dusays.com/.../6a8da73da2991.jpg`,可随时换一行)。404.html 加 `robots: noindex`(不加 OG)。新建 `public/sitemap.xml`(3 URL)与 `public/robots.txt`(Allow all + Sitemap 行),Vite 默认拷贝 public/ → dist/。
- 2026-09-25 深色/浅色主题切换。`settings.ts` 加 `theme: 'dark'|'light'` 字段(默认 dark,loadSettings 严格白名单校验,非法值回退),`applySettings` 写 `html.dataset.theme` + 动态更新 `<meta name="theme-color">`(#14161a ↔ #f6f7f9)。`styles.css` 变量化改造:约 20 处硬编码深色收敛为 `--nav-bg/--nav-link/--glass-bg/--chip-bg/--chip-bg-hover/--glass-border/--glass-border-strong/--img-bg` 8 个变量,新增 `:root[data-theme='light']` 浅色覆盖组(玻璃面改暗透明,`#f6f7f9→#eceef3` 渐变底);灯箱遮罩/按钮/tag 保持恒暗(看图惯例),toggle 旋钮加投影保两态可辨。`SettingsView` 加「主题」行(view-switch 深浅分段按钮,settings 单例直写全站响应)。4 个入口 HTML(index/gallery/settings/404)`<head>` 加防闪烁内联脚本:解析期读 localStorage 提前置 `data-theme`,浅色用户刷新无白闪。测试:settings.test.ts 13 项(+4:light/dark meta 同步、非法回退、LS 预置读出),全量 50 项通过。
- 2026-09-20 三阶段功能落地。**访客设置页**:`settings.html` + `site/settings.ts` 单例(localStorage `lumina.settings`,逐字段 clamp),行数/卡片宽度(`--card-w` 写 `<html>`)/滚动速度/动画开关(`html[data-anim='off']`),`HomeView` 行数变更从已拉取数据重建分桶不重拉,`trackStyle` 时长按速度倍率缩放。**标签系统**:新增纯字面量 `site/tags.ts`(TAGS,键=原图 url)+ `composables.useTags()`(LS `lumina.tags.local` 覆盖,null=清空);图集页搜索扩展到标签,图集卡片渲染 top-6 标签 chips(点击填入搜索);Manager 新增 🏷 标签 Tab(`TagTab.vue`:chips 编辑 + 候选 datalist + 逗号批量),`serve.mjs` 加 `GET/POST /api/tags`,`config-reader.mjs` 加 `readTags/writeTags/sanitizeTagsDoc/validateTagsDoc`,`SYNCABLE_FILES` 纳入 `tags.ts`。**展示增强**:灯箱滚轮/双击/`+`-`0` 键缩放(1–4x)+ 放大拖拽平移(pointer capture)+ 下载按钮 + 当前图标签;图集页「图集 | 全部」双视图(全部 = CSS columns 瀑布流,thumb 加载,点图开灯箱)。**Manager 站点配置**:`ConfigTab.vue` 表单(白名单 5 字段)+ `serve.mjs` `POST /api/viewer-config` + `config-reader.mjs` `validateConfigPatch/mergeConfigPatch/writeConfig`(mode/token 拒改且合并保留原值;⚠ 重写 config.ts 会丢手工注释),`SYNCABLE_FILES` 纳入 `config.ts`。**测试基建修复**:vite 测试 include 补 `*.spec.ts`(Lightbox.spec 此前从未运行);`src/test-setup.ts` 垫片 Node 22 webstorage 空壳抢占 localStorage 问题。测试:根目录 46 项(新增 settings 9 / tags 8 / GalleryView 8 / Lightbox 缩放 2)+ tools 63 项(新增 tags-config 17)。

- 2026-09-15 全量重构为 Vue 3 + Vite + TypeScript:原 `js/`(8 文件)+ `css/`(2 文件)+ 本地 `manager/`(3 文件)合并为 `src/`(shared/site/manager 三层,约 20 文件)。多入口构建(index/gallery/404 → `dist/` 部署;manager → `dist-manager/` 仅本机)。**根治黑框 bug**:`HomeView.vue` 等全部图片 `@load/@error` 完成才克隆行副本 + `.ready` 滚动(旧 `main.js` 在首图加载后就 `finalizeWall`,永久克隆占位卡),保留 30s 强制启动兜底。**修焦点查表键**:按 `Image.url`(原图域)而非 thumb 查 `FOCAL_POINTS`。**修图集 fallback**:移除遗留 legacy galleries 链。数据文件 `src/site/{config,focalPoints,albums}.ts` 保持纯字面量(禁 import/类型注解),`tools` 服务端改用 acorn `sourceType: module` 解析 `export const`;`serve.mjs` 改为服务 `dist-manager/`(缺失自动 `npm run build:manager`),`/api/sync-deploy` 接受 body `{file}` 白名单同步任意数据文件。删除 `tools/build-pages.mjs`,wrangler 构建命令改 `npm run build`。测试:vitest 组件测试(Lightbox/apiClient/utils,根目录)+ node 侧测试(parse-config 等 46 项,tools/)。
- 2026-09-10 主页开屏动画 + 顺序加载:`js/main.js` 的 `renderWall()` 重写为 async,预创建空行 → 跨行打乱队列 → 一张一张串行 `await loadOneImage()` → 全部完成 → 克隆副本 → 加 `.wall.ready` 启动无缝循环。`css/style.css` 新增 `@keyframes fadeInUp`(参考 Cecilian-Hub `PageTransition` 视觉效果,20px 下方淡入,0.6s · cubic-bezier(0.16, 1, 0.3, 1))+ `.is-loading`/`.is-loaded` class。`.row-track` 滚动动画改为 `.wall.ready` 条件触发,加载完才启动。`index.html` 移除 `<p id="loading">` 占位。
- 2026-09-10 (v2) 开屏动画加强 + 行内随机 + 安全兜底:`fadeInUp` 加深至 32px / 0.8s,整墙额外 `@keyframes wallFadeIn` 0.6s 淡入。每个行 slice 独立 `shuffle` 让行内出现顺序也随机。`renderWall()` 加 30s `setTimeout` 兜底:若某些图卡死导致 `.ready` 一直未加,30s 后强制启动滚动。新增 `finalizeWall()` 提取最终化步骤。
- 2026-09-10 (v3) 修复 Retina 屏个别图片破碎:`createCard()` 的 img error handler 检测 `img.currentSrc === item.data.url`(即 2x 原图 404)时,清空 `srcset` + 改 `src = item.data.thumb` 回退到 1x 缩略图,同时 `dataset.fallbackDone` 防止无限循环。失败时 console.warn 打印 `{ name, thumb, url, failedSrc }` 便于排查图床 404。
- 2026-09-09 角色图集改为手动图集:删除 `CONFIG.characters` / `js/character-tags.js` / `js/character-runtime.js` / `tools/ai/build-character-tags.mjs` / `discover-characters.mjs` / `lib/vlm.mjs` / `lib/aliases.mjs` / `lib/corrections.mjs` 等 AI 角色识别整套。新增 `js/albums.js` + `js/album-runtime.js`(用户自命名图集,url → albumId 映射)。Manager 新增 📚 图集 tab:拖拽加图、拖到 🚮 = 解除归属;新建 / 重命名 / 删除图集。Viewer 改为按图集聚合(无 chip 切换、无过滤)。
- 2026-09-09 图床分页自动合并:7bu.top 单页硬上限 40 张(total=59 / last_page=2),代理层并发拉全部页后合并返回。`tools/server/serve.mjs` 的 `fetchUpstreamImages()` 与 `functions/api/images.js` 的 `onRequest` 均改造,前端 `perPage=100` 现在能拿到全部 59 张,前端零修改。
- 2026-09-03 新增图集页（gallery.html）
- 2026-09-03 顶栏重构 + 品牌色（玫红橙渐变）
- 2026-09-03 接入真实图床数据


---

## 项目总结

- 图片托管 [去不图床7bu.top](https://7bu.top)

- 网站托管 [cloudflare Page](https://dash.cloudflare.com/)

- 许可说明 MIT

- 项目链接 https://illusium.pages.dev/

- 仓库地址：https://github.com/Cecilian-Elysian/Lumina

- AI 焦点分析：[@vladmandic/face-api](https://github.com/vladmandic/face-api)
- 本地图集管理: Manager 拖拽（`npm run build:manager` 本机构建，产物不入库）
