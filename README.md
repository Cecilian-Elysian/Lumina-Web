# Lumina-Web · 流动图片墙

Vue 3 + Vite + TypeScript 静态站点：多行叠层流动图片墙 + 图集浏览页 + 本地 Manager 编辑器
图床 token 存在 Cloudflare 环境变量，仓库与前端代码零暴露

## 开始

> **Windows 一键启动：双击 `tools/site.bat`**（自动装依赖 → build → 起服务器 → 开浏览器并带 DevTools）
> **macOS / Linux 一键启动：`./tools/site.sh`**
> 想手动敲命令就用下面这份：

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

## 本地预览主站

- Windows：双击 `tools/site.bat`（一键：装依赖 + build + 起 wrangler + 开浏览器，DevTools 自动展开）
- macOS / Linux：`./tools/site.sh`
- 监听 `127.0.0.1:8001`，走真实图床数据（等价于「开始」里的方式一）
- 每次启动都会重新 build，所以看到的一定是最新代码；改完 `src/` 再跑一次即可
- 服务跑在独立的 `Lumina Site` 黑窗口里：关掉那个窗口、或在里面按 Ctrl+C 即停止
- 缺 `.dev.vars` / `QUBU_TOKEN` 时启动器会直接报错停下（否则只会看到 16 张兜底占位图）
- 已在运行时重复双击不会起第二份服务，只会重新打开浏览器
- 没装过 wrangler 时首次要联网下载（1-3 分钟）；提示登录就先跑 `npx wrangler login`

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
- [x] 收藏夹(灯箱 ⭐ / 瀑布流角标 / 设置页「我的收藏」区块;localStorage 有序列表,导航「收藏」直达;图床下架自动过滤)
- [x] 屏保模式(全屏交叉淡入 + Ken Burns,焦点防裁脸;设置页可调间隔/顺序/缩放,闲置自动进入默认关,`?screensaver=1` 直达)
- [x] 主页内容动态轮换(登台窗口 + 每行重排,定时换掉一批图;设置页可开关/调间隔;系统「减少动态效果」时自动停)
- [ ] 设置搭建(站长端深水区:数据源切换 UI)

## 日志记录

- 2026-10-15 (v5.4) 二次审查修复 + 开屏改造。**①预热登记键错配(核心收益此前归零)**:`preloadItems` 一直预热 `img.thumb` 并用 thumb URL 登记 `loadedUrls`,而模板判定 `is-loaded` 查的是原图 `img.url`,两者永不相交 → 「新卡不淡入闪白」从未生效,且 `loadedUrls` 混入永不命中的条目。现预热按 `devicePixelRatio >= 2` 选候选(高清屏暖 2x 原图,否则暖缩略图,与 srcset 实际请求一致),登记键统一用 `img.url`。**②鼠标悬停时仍会换图**:CSS 已按 `:hover` 暂停滚动,但轮换不知情 → 细看时整墙会淡出约 600ms 并在光标下换图;新增 `isRowHovered()`(遍历 `rowEls` 查 `:hover`)并入 `canRotate`。**③屏保播放时背后空转**:`canRotate` 补 `isScreensaverActive()`(与 `composables.lbOnKey` 的既有判断对齐),避免全屏遮罩下仍重建 DOM/预取图抢带宽。**④换班期间可命中透明卡片**:`opacity:0` 不禁用指针事件,`.wall.swapping .row-track` 补 `pointer-events:none`(与 JS 侧 `onCardClick` 的 `swapping` 守卫双保险)。**⑤开屏动画整块移除**:品牌光环 + LUMINA 标题 + 进度条的每会话开屏观感不佳且与真实进度脱节,删除脚本状态/计时器/模板标签与 `styles.css §20` 全部样式;**保留并独立化**两段加载提示——名单未到显示「加载中…」,图片下载中显示「加载图片 x / N」,不再受开屏开关约束。**⑥灰色占位卡修复(选 A)**:`.card img` 的 `background: var(--img-bg)` 被同元素 `opacity:0` 一起藏掉,占位底从未显示,图片下载期间墙是纯空白;现把占位底/圆角/阴影上移到 `.card`,图片只负责淡入 → 首屏先出一排灰色相框,逐张变清楚(悬停阴影与过渡同步跟到 `.card`,不加 `overflow:hidden` 以免裁掉悬停上移)。**测试**:未新增用例(行为修复,现有 156 项全过),typecheck + `build` + `build:manager` 通过,构建产物已逐项校验 8 项改动均生效。
- 2026-10-15 (v5.2) 主页内容动态轮换。解决「主页反复播放同一批图、同一顺序」的无聊感。**机制**:新增纯函数模块 `site/wallRotate.ts`(`windowSize` 计算登台窗口张数:至少填满一屏/池子 60%/行数,封顶全量;`nextWindow` 环形取窗并前进游标,缺省步长 = 窗口一半保证相邻窗重叠)。`HomeView` 的 `gallery` 改为固定顺序全量池,`RowItem.gi` 恒指向池下标 → 灯箱 `open(gallery)` 的 ←/→ 导航始终正确;墙上只渲染一个「登台窗口」,到点后滑动窗口换掉约一半图 + 每行重新洗牌(内容与顺序双焕新),整圈走完重洗池子。**无缝切换**:轨道 DOM 保留(动画相位连续),换班时整墙按行错峰淡出(`.wall.swapping .row-track{opacity:0}` + `trackStyle` 注入 `transitionDelay`)在不可见时替换内容再淡入,无位置跳变;下一窗在间隔期用 `new Image()` 预热(仅暖缓存,开屏前不改 `loadedUrls` 以免误判就绪;墙就绪后预热成功才 `markLoaded`,避免新卡淡入闪白)。**暂停时机**:开屏中/后台(`visibilitychange`)/拖拽中/已双击暂停/灯箱打开/动画关闭 时不轮换,交互结束与回到前台重置计时器;`resize`(防抖)仅在需「变宽补卡」时重建,防循环露白。**设置**:`settings.ts` 新增 `autoRotate`(默认开)/`rotateSec`(默认 45,15–180 clamp)与 `ROTATE_RANGE/ROTATE_CHOICES`;设置页「图片墙设置」加「内容轮换」开关 + 「轮换间隔」分段(关时禁用)。**测试**:新增 `wallRotate.test.ts` 14 项(窗口尺寸边界/环形前进包裹/覆盖全池/防御),`settings.test.ts` 更新精确 `toEqual` 并 +3 项。根目录 150 项全过,typecheck + `npm run build` 通过。
- 2026-10-15 (v5.2 审查修复) 代码审查后修 5 处。**①换班瞬间点卡片会开错图**:整圈重洗已换池、画面还是旧 `gi`,`onCardClick` 未拦 `swapping` → 现开头 `if (swapping.value) return`,与 `onRowDown` 既有拦截对齐。**②换班中 resize 并发两次换班**:`onResize`(防抖)补 `swapping.value` 早退,并改走统一的排定/兑现路径。**③预热与实际换班批次可能对不上**:新增「排定窗口」(`RotationPlan`)——`scheduleRotate` 时就把下一窗(含重洗后的池顺序)算好并预热,`rotateNow` 直接兑现,预热与换上来的必然同一批图,消除整圈重洗时新卡淡入闪白。**④超大图库窗口过重**:`wallRotate.WINDOW_MAX = 90`,`windowSize` 的比例项封顶(fill 项不受限,宁可超上限也不能循环露白);400 张时窗口由 240 降到 90,每次预热量减半以上。**⑤系统「减少动态效果」下不再自动轮换**:新增 `wallRotate.prefersReducedMotion()`(无 `matchMedia` 的老环境安全返回 false),`canRotate/canScheduleRotate` 均排除,并订阅媒体查询变化动态停/启(兼容旧 Safari `addListener`)。**测试**:`wallRotate.test.ts` +6(封顶 / 填屏下限可超上限 / reduced-motion 三分支),20 项。根目录 156 项全过,typecheck + `npm run build` 通过。
- 2026-10-15 (v5.3) 主站本地预览一键启动。**背景**:此前只有手动敲 `npm run build` + `npx wrangler pages dev dist --port 8001` 才能看到真实图床数据(`npm run dev` 走 Vite、无 `/api/images`,只有 16 张兜底占位图),对非技术使用者门槛偏高。**新增**:`tools/site.bat`(Windows,ASCII + CRLF,规则见 `tools/start.bat` 头部)+ `tools/site.sh`(macOS/Linux)。流程完全照抄既有 `tools/dev.bat` 骨架:预检 node / `.dev.vars` / `node_modules` → `npm run build` → `start "Lumina Site" cmd /c "npx wrangler pages dev dist --port 8001"` → 单条 PowerShell 轮询 8001(超时 180s,首跑 npx 下载 wrangler 较慢)→ 探测 Chrome/Edge/默认浏览器并带 `--auto-open-devtools-for-tabs` 打开 `127.0.0.1:8001`。**设计取舍**:①wrangler 的登录提示/报错**不重定向到日志文件**,而是留在独立窗口里——藏起来会导致用户看不到提示、服务假装启动、最后超时(与 `dev.bat` 的 serve.mjs 不同,后者不会交互);②显式 `--port 8001` 让 URL 确定(与 README「开始」方式一同一端口),避免端口漂移导致开错页面;③`.dev.vars` / `QUBU_TOKEN` 缺失时**直接报错停下**,避免用户以为启动器坏了——实际是只会看到占位图;④幂等:8001 已在监听则跳过 build 与启动,只重新开浏览器。**验证**:用打了桩的副本(替换 `start "" "!` 开浏览器行为)跑通两条分支——已在运行分支首次实测**暴露并修掉一个真 bug**(`:SERVER_RUNNING` 缺 `goto OPEN_BROWSER`,会顺序落进 `:SERVER_TIMEOUT` 报错退出);另实测 `.dev.vars` 缺失分支正确拦截;`bash -n` 通过。**文档**:`README.md` 加「本地预览主站」小节 + 「开始」补一键入口,`tools/README.md` 目录树补两项。纯新增启动器与文档,未触碰任何业务代码,156 项测试与 typecheck 不受影响。

- 2026-10-06 (v5.1) 三智能体代码审查修复(P0/P1 全量)。**P0**:ScreensaverOverlay 改为 `watch(active)` 驱动挂载/卸载副作用(原 `onMounted` 即锁 `body.overflow` 会锁死全站滚动),双 rAF 点亮首张保证从黑场真实淡入,退出时槽位复位、重入不残留旧图;`initScreensaver` 幂等 + `showToken` 世代守卫(hide 必胜,作废在途 show)+ `advancePlaylist` 空表防御 + 预加载改为「下一张」;`composables.lbOnKey` 屏保激活时不透传灯箱键盘(防 Esc 连关两层/隐形切图),`useLightbox` 加 `getCurrentInstance` 守卫(非组件上下文不再注册重复键盘监听);favorites 查询改 `computed Set` 索引(O(1))+ 空串键早退。**P1**:闲置重置 1s 节流(清除旧计时器不受节流影响)、`visibilitychange` 回可见重武装 + 后台跳过换图、URL 直达严格匹配 `screensaver=1`、Ken Burns 开关改 `animation-play-state`(冻结不重启不跳变)、设置页 `#favs` 滚动提前到拉列表之前(空态秒滚)、图床回退兜底图时收藏区区分「加载失败」文案、收藏缩略条接 `focalStyle` 防裁脸、瀑布流角标加 `visibility` 门控(消灭桌面隐形热区)、导航「收藏」项在 `#favs` 时高亮、灯箱 ⭐ 补 `aria-pressed`、masonry 角标样式归位。**测试**:新增 ScreensaverOverlay.spec 8 项(淡入/交叉/重入复位/免疫/提示/滚动锁协调/kenburns 冻结),screensaver.test +5(空列表/两图轮换/hide 竞态/URL 直达/后台跳过换图),SettingsView +1(兜底图空态文案)+ mock 补 `isFallback`,Lightbox/GalleryView spec 文件级收藏单例复位。根目录 129 项 + tools 72 项全过,typecheck + `npm run build` 通过。

- 2026-10-06 (v5) 收藏夹 + 屏保模式。**收藏夹**:新增 `site/favorites.ts` 单例(localStorage `lumina.favs` 有序数组,新收藏插头部 = 最近在前,键 = `Image.url` 与焦点/图集/标签/点赞一致;LS 损坏/隐私模式静默降级);灯箱加 ⭐ 按钮(♥ 右侧,金色 faved 态)、瀑布流加收藏角标(点赞角标上方,未收藏悬停浮现/触屏常显,`click.stop` 不进灯箱);设置页新增「我的收藏」区块(`#favs` 锚点):计数 + 全量缩略预览条(横向滚动)+ 查看全部(灯箱打开收藏列表)/清空(两击确认),与本次拉取图片求交集过滤已下架图(LS 保留,图回归自动恢复);导航栏加「收藏」项直链 `settings.html#favs`(Vue 渲染晚于原生锚点,onMounted 检测 hash 补 `scrollIntoView`)。**屏保模式**:`settings.ts` 新增 `screensaver` 子对象(`idleMin` 0=关/1/3/5/10 分、`intervalSec` 3–120 秒、`order` random/seq、`kenBurns`,逐字段 clamp);新增 `site/screensaver.ts` 单例(`active/current` + 序列管理:random 走完一圈 Fisher-Yates 重洗且首项≠当前项、seq 循环、下一张预加载)+ `ScreensaverOverlay.vue`(双层 `<img>` 1.5s 交叉淡入、Ken Burns scale 1→1.08 时长=间隔+2s、`focalStyle` 焦点定位防裁脸、退出信号 pointerdown/keydown/wheel/touchstart 不含 pointermove 且进入后 800ms 免疫、首次操作提示 3s 淡出);`initScreensaver()` 挂 App.vue(闲置事件重置计时,`document.hidden` 跳过;`?screensaver=1` 直达);设置页新增「屏保」区块(立即进入/闲置分段/间隔分段/顺序/缩放开关)。**测试**:favorites 9 项、screensaver 12 项(纯函数 + 单例 + fake timers 闲置)、settings +5 项(screensaver clamp)、Lightbox +2(⭐ 切换/跟随)、GalleryView +1(角标)、SettingsView.spec 新建 8 项(单例 API 复位,LS 预置对已加载 ref 无效的教训)。根目录 114 项 + tools 72 项全过,`npm run build` 通过。

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
