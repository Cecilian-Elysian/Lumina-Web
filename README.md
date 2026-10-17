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


---

## 项目总结

- 图片托管 [去不图床7bu.top](https://7bu.top)

- 网站托管 [cloudflare Page](https://dash.cloudflare.com/)

- 许可说明 MIT

- 项目链接 https://illusium.pages.dev/

- 仓库地址：https://github.com/Cecilian-Elysian/Lumina

- AI 焦点分析：[@vladmandic/face-api](https://github.com/vladmandic/face-api)
- 本地图集管理: Manager 拖拽（`npm run build:manager` 本机构建，产物不入库）
