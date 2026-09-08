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


---

## 操作指南

>正在编写......

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
│   ├── config.js                    # 配置文件(模式/字段映射/布局/characters/galleries,不含 token)
│   ├── main.js                      # 主页逻辑:拉取 → 渲染 → 灯箱
│   ├── gallery.js                   # 图集页逻辑:角色聚合 → 搜索 → 渲染网格 → 灯箱
│   ├── focal-points.js              # 焦点数据(由 tools/ 产出)
│   ├── focal-runtime.js             # 焦点运行时消费者
│   ├── character-tags.js            # 角色打标数据(由 tools/ai/build-character-tags.mjs 产出)
│   └── character-runtime.js         # 角色标签运行时消费者(LS 覆盖层)
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
│   │       └── config-reader.mjs    # 共享:读 viewer 的 config.js / focal-points.js
│   │
│   └── ai/                          # AI 工具(命令行)
│       ├── build-focal-points.mjs   # 人脸检测 + 批量分析(含 --download-only)
│       ├── build-character-tags.mjs # MiniMax VLM 批量识别角色 → character-tags.js
│       └── analyze-images.mjs       # 列出 viewer 当前所有图片 URL
│
├── dist/                            # 构建产物(Git 忽略,仅含 Viewer)
├── wrangler.toml                    # Cloudflare Pages 输出目录配置
├── .dev.vars                        # 本地开发密钥(git 忽略,不入库)
```


---

## 功能设计

- [x] 主页搭建
- [x] 图集搭建
- [x] 角色图集（图集页）+ AI 角色识别
- [ ] 设置搭建
- [ ] 控制台搭建

## 日志记录

- 2026-09-08 图集页重构为角色图集：搜索框启用（角色名 / 别名即时过滤）；新增 `js/character-runtime.js` 与 `js/character-tags.js`；新增 `tools/ai/build-character-tags.mjs`（MiniMax VLM 离线批量打标）
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
- AI 角色识别：MiniMax VLM（离线批量，密钥在 `.dev.vars` 的 `MINIMAX_API_KEY`）

- 控制台仓库: 还没开始写qwq