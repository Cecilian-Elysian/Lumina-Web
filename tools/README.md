# Lumina Tools · 编辑器

本地运行的服务与 AI 工具，为 `../js/focal-points.js` 产出焦点数据 + `../js/albums.js` 提供图集管理 API。
Manager UI 位于项目根目录 `manager/`，整目录被 Git 忽略；Tools 源码正常进入 GitHub，但不会进入 Cloudflare 的 `dist/`。

按职责分目录组织：

```
tools/
├── start.bat / start.sh         ← 终端启动器（Win / Unix）
├── dev.bat                      ← Windows 一站式：装依赖 + 启服务 + 打开浏览器(DevTools 自动开)
├── console.bat                  ← Windows 快捷键：服务已启时直接打开浏览器(DevTools 自动开)
├── package.json                 ← Node 依赖
├── README.md                    ← 本文件
├── build-pages.mjs              ← 生成 Cloudflare Pages 的 dist/
│
├── server/                      ← ★ 启动器 + HTTP 服务器
│   ├── serve.mjs                ← 入口（node server/serve.mjs）
│   └── lib/
│       └── config-reader.mjs    ← 共享：读取 viewer 的 config.js / focal-points.js / albums.js
│
└── ai/                          ← ★ AI 工具（命令行）
    ├── build-focal-points.mjs   ← 人脸检测 + 批量分析（含 --download-only）
    └── analyze-images.mjs       ← 列出 viewer 当前所有图片 URL
```

---

## 快速开始

### 1. 启动可视化编辑器

**Windows（推荐）：** 双击 `dev.bat` —— 一站式完成"装依赖 → 启动服务 → 等待就绪 → 打开 Edge/Chrome(DevTools 自动开)"

服务已运行但想新开一个标签页？再双击 `console.bat`。

要查看原始日志（前台运行）：双击 `start.bat`。

**macOS / Linux：**
```bash
./start.sh
```

**或跨平台：**
```bash
node server/serve.mjs
```

启动后会：
- 自动检测 Node.js（需要 ≥18）
- 检查本地 `../manager/index.html` 是否存在
- 首次运行自动 `npm install`
- 分配端口（默认 8002，冲突顺延 8003/8004）
- 自动打开浏览器到实际端口的 `/manager/`

> **Ctrl+C 优雅关闭**：关闭浏览器后，在启动的命令行窗口按 Ctrl+C 即可停止服务。

### 2. 可选参数

```bash
node server/serve.mjs --port=9000    # 自定义端口
node server/serve.mjs --no-launch    # 不自动打开浏览器
node server/serve.mjs --no-install   # 跳过依赖检查
```

---

## 可视化编辑器使用

Manager 有两个 tab：

### 📍 焦点 tab

| 按钮 | 作用 |
|---|---|
| **↻ 读取图片列表** | 通过本地代理拉真实图床；失败时加载 viewer 兜底图 |
| **🧠 AI 批量分析** | 调用 AI 工具，自动检测人脸并写回 viewer |
| **💾 保存到 viewer** | 把当前会话的编辑结果写入 `../js/focal-points.js` |
| **↥ 同步并部署** | 仅提交并推送 `js/focal-points.js` 到 `origin/main`，触发 Cloudflare Pages 部署 |
| **📋 导出 JSON** | 不写入，只导出 JSON 文本（用于复制粘贴） |

#### 单图编辑

1. 点击网格中任意图片 → 弹出编辑器
2. **点击图片任意位置** 或 **拖动白点** 设置焦点
3. 右侧实时预览三档卡片高度（230/190/140）的裁剪效果
4. **✓ 保存** → 写入 localStorage（本次会话）
5. **🗑️ 清除** → 删除该图的焦点

> 编辑结果保存在浏览器 `localStorage.lumina.focal.local`，
> 只在本浏览器有效，**点"💾 保存到 viewer"才会写入文件并 git 可见**。

### 📚 图集 tab

| 按钮 / 交互 | 作用 |
|---|---|
| **＋ 新建图集** | 输入名字 + 随机 8 字符 id |
| **图集 chip** 上的 ✏️ | 重命名该图集 |
| **图集 chip** 上的 🗑 | 删除图集（旗下 url 自动降级为未分组） |
| **🚮 未分组 chip** | 拖到此 = 解除归属 |
| **拖图片 → 图集** | 把图片加入图集 |
| **💾 保存到 viewer** | 把改动写入 `../js/albums.js` |
| **↥ 同步并部署** | 仅提交并推送 `js/albums.js` 到 `origin/main` |

#### 工作流

1. 点 **＋ 新建图集** → 输入"德克萨斯" → 创建
2. 从图片网格拖图到该 chip → 数字 +1
3. 拖错/不想保留 → 拖到 🚮 解除
4. 点 **💾 保存到 viewer** → 写入 `js/albums.js`
5. `git add js/albums.js && git commit && git push` 触发部署

> 编辑结果保存在 `localStorage.lumina.album.local`，仅本浏览器有效。
> 手动覆盖：`localStorage.setItem('lumina.album.local', JSON.stringify({ url: 'albumId' }))`，刷新即生效。

---

## AI 批量分析（命令行）

无需打开编辑器，直接在终端跑：

```bash
cd tools
npm install                              # 首次

# 基础：用 config.js 的兜底图，生成 max（最大脸）策略
node ai/build-focal-points.mjs

# 多人合影：用所有人脸包围盒中心
node ai/build-focal-points.mjs --strategy=center

# 从真实图床拉数据（token 从 viewer 根目录 .dev.vars 读取）
node ai/build-focal-points.mjs --source=upstream

# 调整并发下载数（默认 4）
node ai/build-focal-points.mjs --concurrency=8

# 仅下载模型（不分析）
node ai/build-focal-points.mjs --download-only

# 或用 npm script（更简短）
npm run ai
npm run ai:center
npm run download
```

首次运行会自动下载 face-api 模型到 `./weights/`（~6MB，已被 `.gitignore` 排除）。

### CLI 参数一览

| 参数 | 默认 | 说明 |
|---|---|---|
| `--strategy=max` | ✓ | 每张图取最大人脸作为焦点 |
| `--strategy=center` | | 多人合影时，取所有人脸包围盒的几何中心 |
| `--source=fallback` | ✓ | 数据源：viewer 的 `fallbackImages` |
| `--source=upstream` | | 数据源：viewer 实际图床 API |
| `--concurrency=N` | 4 | 并发下载数（1~16） |
| `--download-only` | | 只下载模型，跳过分析 |

---

## 辅助命令

```bash
# 列出 viewer 当前所有图片 URL（兜底图）
node ai/analyze-images.mjs
# 或
npm run list

# 输出 JSON 格式
node ai/analyze-images.mjs --json
```

---

## API 端点（由 server/serve.mjs 提供）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/` | 302 → `/manager/` |
| GET | `/manager/*` | 根目录本地 `manager/` 内静态文件 |
| GET | `/api/viewer-config` | 读取 `../../js/config.js` |
| GET | `/api/focal-points` | 读取 `../js/focal-points.js` |
| POST | `/api/focal-points` | 写入 `../js/focal-points.js`（body=JSON） |
| GET | `/api/albums` | 读取 `../js/albums.js` |
| POST | `/api/albums` | 整体覆盖写回 `../js/albums.js`（body={_meta, ...url→id}） |
| POST | `/api/albums/add` | body=`{name}` → 创建新图集，返回 `{id, name}` |
| POST | `/api/albums/rename` | body=`{id, name}` → 重命名 |
| POST | `/api/albums/delete` | body=`{id}` → 删除图集，旗下 url 自动降级为未分组 |
| GET | `/api/proxy-images` | 尝试从 viewer 上游图床拉取真实数据(自动分页合并,单页 40 张硬上限被代理吸收) |
| POST | `/api/sync-deploy` | 仅提交并推送 `js/focal-points.js` 到 `origin/main` |
| POST | `/api/run-ai` | spawn AI 工具，SSE 流式返回日志 |

---

## 常见问题

**Q：启动后浏览器没自动打开？**
A：查看终端输出的实际端口，手动访问 `http://127.0.0.1:<端口>/manager/`。

**Q：提示缺少 manager/index.html？**
A：`manager/` 被 Git 忽略且只保存在本机，请从本机备份恢复该目录。

**Q：AI 工具报"无法加载模型"？**
A：检查网络，首次需要从 GitHub 下载模型。
可访问 https://github.com/vladmandic/face-api/tree/master/model 手动下载。

**Q：编辑后 viewer 没生效？**
A：必须点 "💾 保存到 viewer"，否则只存在 localStorage。

**Q：AI 检测不到某些人脸？**
A：提高图片清晰度，或手动用编辑器加图集拖拽按钮。

**Q：Node.js 版本不够？**
A：需要 ≥18，前往 https://nodejs.org 下载新版。

---

## 部署边界

- `node build-pages.mjs` 只复制 `index.html`、`css/`、`js/` 到 `../dist/`。
- `tools/`、`manager/`、`.dev.vars` 和模型权重不会进入 Cloudflare 静态产物。
- 本地服务只监听 `127.0.0.1`。