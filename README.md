# Lumina-Web · 流动图片墙

Vue 3 + Vite + TypeScript 静态站点：多行叠层流动图片墙 + 图集浏览页 + 本地 Manager 编辑器
图床 token 存在 Cloudflare 环境变量，仓库与前端代码零暴露

## 开始

```bash
npm install

# 方式一（推荐，带 /api/images 代理，可看真实图床数据）：
npm run build
npx wrangler pages dev dist --port 8001
# 打开 http://127.0.0.1:8001

# 方式二（Vite 开发服务器，无代理 → 回退兜底图）：
npm run dev
# 打开 http://127.0.0.1:5173

# 方式三（纯静态服务器，无代理 → 回退兜底图）：
python -m http.server 8000
```

>代理模式需在 .dev.vars 写入 QUBU_TOKEN=你的token

## 页面（Vite 多入口）

- index.html — 主页（流动图片墙 + 灯箱）
- gallery.html — 图集页（相册网格 + 灯箱）
- 404.html — Cloudflare 未知路径 404 页面
- manager.html — 本地 Manager 编辑器（构建到 dist-manager/，不部署）

## 部署

### ⚠️ 必须先设 Dashboard（Git 集成生效前必做）

`wrangler.toml` 的 `[build] command` 仅供 `wrangler pages dev`/`wrangler pages deploy` CLI 使用；
**Cloudflare Pages Dashboard 的 Git 集成项目会忽略它**——必须手动在 Dashboard 配置 Build command。

进入 **Cloudflare Dashboard → Workers & Pages → lumina → Settings → Builds**：

| 字段 | 值 |
|---|---|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (留空，仓库根) |

然后在 **Settings → Environment variables** 添加：

| 变量 | 类型 | Production / Preview 都填 |
|---|---|---|
| `NODE_VERSION` | Plaintext | `20` |
| `TOKEN`（或 `QUBU_TOKEN`） | **Secret** | (你的 7bu.top Bearer token) |

> `TOKEN` 和 `QUBU_TOKEN` 都接受，Dashboard 用了哪个都生效。

> 没设 `NODE_VERSION` 时 CF 默认 Node 12，`npm install` 会失败；构建失败会导致页面空白。
> 没填 `Build command` 时 CF 不跑构建，直接把仓库根当产物部署——`index.html` 里的 `<script src="/src/site/main.ts">` 会被原样 deploy，浏览器加载 `.ts` 失败（CF 默认 MIME `video/mp2t`）。

### 验证

```bash
# 部署后 Network 面板检查:
curl -I https://illusium.pages.dev/assets/main-*.js
# 应返回 200 + Content-Type: application/javascript
curl -s https://illusium.pages.dev/ | grep -i 'script'
# 应输出 <script type="module" crossorigin src="/assets/main-*.js">
# 而不是 /src/site/main.ts
```

### 备选：CLI 手动部署（绕开 Dashboard Git 集成）

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name=lumina --branch=main
```

需要环境变量 `CLOUDFLARE_API_TOKEN`（在 CF Dashboard → My Profile → API Tokens 创建）。

### 备选：GitHub Actions 部署（仓库自带 `.github/workflows/deploy.yml`）

如果不想在 CF Dashboard 设 Build command，可以走 Actions：
1. Dashboard → Settings → Builds → Build command 设为空（或禁用 Git 集成）
2. GitHub repo → Settings → Secrets 添加 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`
3. 每次 push main Actions 自动 build + deploy

## 运维风险提示

- **图床分页合并是"不设上限"的**:7bu.top 单页最多 40 张,代理会**并发拉所有分页**。如果图床总图片数很多(> 400 张),单次 `/api/images` 请求会瞬时发起十几个并发请求打到图床。建议把图床图片数量控制在 **400 张以内**(约 10 个分页以内);代理层在 `last_page > 10` 时会在 Cloudflare 控制台打警告日志,可作为运维信号。
- **AI 批量焦点分析是 merge 而非覆盖**:重跑 `node ai/build-focal-points.mjs` 不会再清掉手工标注的焦点(详见 `tools/server/lib/config-reader.mjs` 的 `mergeFocalPoints`)。


---

## 操作指南

>正在编写......

### Windows 用户

- **首次启动**:双击 `tools/dev.bat` —— 一站式完成"装依赖 → 启动服务 → 等待端口 → 打开 Chrome/Edge(DevTools 自动开)"
- **服务已启,新开标签**:双击 `tools/console.bat`
- **看原始日志**:双击 `tools/start.bat`(前台运行)

服务只监听 `127.0.0.1:8002`,关闭启动窗口或 `Ctrl+C` 即可停服。详见 `tools/README.md`。

### macOS / Linux 用户

```bash
./tools/start.sh
```

## 文件结构

```
Lumina-Web/
|
├── index.html                       # 主页 Vite 入口(window.__VIEW__ = 'home')
├── gallery.html                     # 图集页 Vite 入口('gallery')
├── 404.html                         # 404 页 Vite 入口('notfound')
├── manager.html                     # Manager Vite 入口(仅本机构建,不部署)
|
├── src/
│   ├── shared/                      # 前后端共享:类型 / 工具 / API 客户端
│   │   ├── types.ts                 # Image / FocalPoint / AlbumMeta / AlbumsDoc 契约
│   │   ├── utils.ts                 # 纯函数(focalStyle / fileName / srcSet...)
│   │   └── apiClient.ts             # 图片列表获取 + mapImage 字段映射
│   │
│   ├── site/                        # Viewer(部署到 Cloudflare)
│   │   ├── config.ts                # 配置(纯字面量,tools 服务端 acorn 解析)
│   │   ├── focalPoints.ts           # 焦点数据(由 tools/ 产出,纯字面量)
│   │   ├── albums.ts                # 图集元数据 + url 映射(纯字面量)
│   │   ├── composables.ts           # useFocal / useAlbums / useLightbox / useErrorBanner
│   │   ├── main.ts                  # Viewer 入口
│   │   ├── App.vue                  # 按 window.__VIEW__ 切换视图
│   │   ├── HomeView.vue             # 流动墙(等全部图加载完成才滚动,根治黑框)
│   │   ├── GalleryView.vue          # 图集网格 + 搜索
│   │   ├── NotFoundView.vue         # 404
│   │   ├── Lightbox.vue             # 灯箱(键盘 / 预加载相邻图)
│   │   └── styles.css               # 全部样式(含主题变量、动画、响应式)
│   │
│   └── manager/                     # Manager(本地编辑器)
│       ├── main.ts                  # Manager 入口
│       ├── api.ts                   # 编辑器 API 层(图片列表 / 焦点 / 图集 / 同步)
│       ├── App.vue                  # Tab 切换(焦点 / 图集)
│       ├── FocalTab.vue             # 焦点列表 + AI 批量分析(SSE)
│       ├── FocalEditor.vue          # 单图焦点可视化编辑 + 拖拽微调
│       ├── AlbumTab.vue             # 图集 chips + 图片网格 + 拖拽归类
│       ├── AlbumChip.vue            # 单个图集 chip(拖放目标)
│       ├── AlbumModal.vue           # 新建 / 重命名图集
│       └── styles.css               # Manager 样式
|
├── functions/api/images.js          # Pages Function 代理(服务端注入 token)
|
├── tools/                           # 可跟踪的本地服务、AI 与构建工具
│   ├── start.bat / start.sh         # 一键启动(Win / Unix)
│   ├── package.json                 # Node 依赖 + npm scripts
│   ├── README.md                    # tools/ 使用说明
│   │
│   ├── server/                      # 启动器 + HTTP 服务器
│   │   ├── serve.mjs                # 入口(自检 + 装依赖 + 自动构建 manager + 开浏览器)
│   │   └── lib/
│   │       └── config-reader.mjs    # 共享:acorn 安全解析 src/site/*.ts 数据文件
│   │
│   ├── test/                        # node 侧测试(独立 vitest 配置)
│   └── ai/                          # AI 工具(命令行)
│       ├── build-focal-points.mjs   # 人脸检测 + 批量分析(含 --download-only)
│       └── analyze-images.mjs       # 列出 viewer 当前所有图片 URL
│
├── dist/                            # Viewer 构建产物(Git 忽略,部署)
├── dist-manager/                    # Manager 构建产物(Git 忽略,仅本机)
├── vite.config.ts                   # 双模式构建(mode=manager → dist-manager)
├── wrangler.toml                    # Cloudflare Pages 构建配置
└── .dev.vars                        # 本地开发密钥(git 忽略,不入库)
```


---

## 功能设计

- [x] 主页搭建
- [x] 图集搭建
- [x] 图集页(用户手动图集)+ 本地管理器拖拽
- [x] 焦点编辑器 + AI 焦点识别
- [ ] 设置搭建

## 日志记录

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