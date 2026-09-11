# Lumina-Web · 流动图片墙

纯 HTML + CSS + JS 的静态站点：多行叠层流动图片墙 + 图集浏览页
图床 token 存在 Cloudflare 环境变量，仓库与前端代码零暴露

## 开始

```bash
# 方式一（推荐，带 /api/images 代理，可看真实图床数据）：
node tools/build-pages.mjs
npx wrangler pages dev dist --port 8001
# 打开 http://127.0.0.1:8001

# 方式二 (纯静态服务器，无代理 → 回退兜底图) :
python -m http.server 8000
# 打开 http://127.0.0.1:8000
```

>代理模式需在 .dev.vars 写入 QUBU_TOKEN=你的token

## 页面

- index.html — 主页（流动图片墙 + 灯箱）
- gallery.html — 图集页（相册网格 + 灯箱）

## 部署

1. GitHub 仓库：%用户名%/Lumina-Web
2. Cloudflare Pages → Connect to Git → 构建命令 `node tools/build-pages.mjs` → 输出 `dist`
3. 环境变量 `QUBU_TOKEN` 添加到 Production 与 Preview
4. 每次 push main 自动部署

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
├── index.html                       # 主页骨架(顶栏 / 图片墙容器 / 灯箱)
├── gallery.html                     # 图集页骨架(顶栏 / Hero / 相册网格 / 灯箱)
├── 404.html                         # Cloudflare 未知路径 404 页面
|
├── css/
│   ├── style.css                    # 全部样式(含主题变量、动画、响应式)
│   └── gallery.css                  # 图集页专用样式(Hero / 网格 / 卡片)
|
├── js/
│   ├── config.js                    # 配置文件(模式/字段映射/布局/galleries,不含 token)
│   ├── main.js                      # 主页逻辑:拉取 → 渲染 → 灯箱
│   ├── gallery.js                   # 图集页逻辑:图集聚合 → 搜索 → 渲染网格 → 灯箱
│   ├── focal-points.js              # 焦点数据(由 tools/ 产出)
│   ├── focal-runtime.js             # 焦点运行时消费者
│   ├── albums.js                    # 图集元数据 + url 映射(由 manager/ 拖拽产出)
│   └── album-runtime.js             # 图集运行时消费者(LS 覆盖层)
|
├── functions/api/images.js          # Pages Function 代理(服务端注入 token)
|
├── tools/                           # 可跟踪的本地服务、AI 与构建工具
│   ├── start.bat / start.sh         # 一键启动(Win / Unix)
│   ├── package.json                 # Node 依赖 + npm scripts
│   ├── README.md                    # tools/ 使用说明
│   ├── build-pages.mjs              # 生成 Cloudflare 白名单静态产物(含 gallery.html)
│   │
│   ├── server/                      # 启动器 + HTTP 服务器
│   │   ├── serve.mjs                # 入口(自检 + 装依赖 + 开浏览器 + HTTP)
│   │   └── lib/
│   │       └── config-reader.mjs    # 共享:读 viewer 的 config.js / focal-points.js / albums.js
│   │
│   └── ai/                          # AI 工具(命令行)
│       ├── build-focal-points.mjs   # 人脸检测 + 批量分析(含 --download-only)
│       └── analyze-images.mjs       # 列出 viewer 当前所有图片 URL
│
├── dist/                            # 构建产物(Git 忽略,仅含 Viewer)
├── wrangler.toml                    # Cloudflare Pages 输出目录配置
├── .dev.vars                        # 本地开发密钥(git 忽略,不入库)
└── manager/                         # 本地编辑器(被 .gitignore 忽略):焦点 + 图集拖拽
```


---

## 功能设计

- [x] 主页搭建
- [x] 图集搭建
- [x] 图集页(用户手动图集)+ 本地管理器拖拽
- [x] 焦点编辑器 + AI 焦点识别
- [ ] 设置搭建

## 日志记录

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
- 本地图集管理: Manager 拖拽（git 忽略，仅本机）