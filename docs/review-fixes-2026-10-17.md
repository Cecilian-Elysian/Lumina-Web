# 全面审查修复记录

> 2026-10-17。对仓库做了一次三方并行审查（前端 site/shared、后端 functions/tools、Manager + 基建），
> 逐项核实后按严重度分 P0/P1/P2 三档修复。本文档记录每项的「问题 → 修复 → 位置」。
> 验证基线：`npm run typecheck`、`npm run typecheck:functions`、站点测试 156 项、tools 测试 98 项、双 build 全绿。
> 对应提交：`ea5faaf`(P0)、`feb8fbd`(P1)、`c9b934c`(P2)。

---

## P0 — 会挂 CI / 有安全风险 / 会出错误数据的（3 个提交中的第 1 个）

### P0-1 CI 在 Node 20 上必挂（上阶段引入的回归）
- **问题**：`visit-sql.test.mjs` 用了 Node 内置的 `node:sqlite`（要求 Node ≥ 22.5），但 CI 还在用 Node 20 —— tools 测试在 CI 上必然失败。
- **修复**：CI 升 Node 22；`tools/package.json` 的 engines 改为 `>=22.5.0`；测试文件对 `node:sqlite` 加运行时守卫，缺模块时整组用例跳过而不是加载崩。
- **位置**：`.github/workflows/ci.yml`、`tools/package.json`、`tools/test/visit-sql.test.mjs`

### P0-2 tools 测试在 CI 上靠“巧合”跑起来
- **问题**：CI 从未安装 `tools/` 的依赖，vitest 是靠 npm 沿目录向上找到根目录的 vitest 才跑起来的；依赖缓存也只看根 `package-lock.json`。
- **修复**：CI 加 `npm ci --prefix tools` 步骤；缓存路径同时声明根与 tools 两份 lock 文件。
- **位置**：`.github/workflows/ci.yml`

### P0-3 本地编辑器服务器没有来源门禁
- **问题**：`serve.mjs` 虽然只监听 127.0.0.1，但恶意网页发的请求照样能到达本机端口：DNS rebinding 可以借浏览器读响应；`<form>` 简单请求可以跨站触发“写文件 + git push”级别的写接口（CORS 拦得住读响应、拦不住动作本身）。
- **修复**：请求入口加两道门——Host 必须是 `127.0.0.1/localhost:<实际端口>`（端口启动时动态记录）；带 Origin 的请求必须是同源。不符合直接 403 并记日志。
- **位置**：`tools/server/serve.mjs`（`isLocalRequest` + createServer 入口）

### P0-4 图片代理的边缘缓存会被小请求“污染”
- **问题**：`/api/images`（Cloudflare Function）冷缓存路径不按 `per_page` 截断，且把「按本次请求拉的页数」存进缓存。先来一个 `per_page=1` 的请求，缓存里就只剩 1 页；之后任何要更多图的请求都得等缓存过期。另外命中路径有一段永远走不到的死分支。
- **修复**：缓存里存**未截断的全量目录**（TTL 由入缓存副本的 `Cache-Control` 控制，5 分钟）；命中时按本次 `per_page` 切片返回；切片后若**缓存量不够本次要的、且上游还有更多**，视为未命中回源补齐。删除死分支。测试同步更新并新增 2 个防污染用例。
- **位置**：`functions/api/images.js`、`tools/test/images-proxy.test.mjs`

### P0-5 图片墙“换班”存在并发竞态
- **问题**：定时轮换与 resize 重排可能交错进行 `swapTo`：两个窗口内容交错写回，滚动位置与图片映射错位（行 A 显示行 B 的图）。
- **修复**：`swapping` 标志兼作互斥锁——`swapTo` 入口与 `canRotate()` 都检查它，同一时刻只允许一次换班。
- **位置**：`src/site/HomeView.vue`

---

## P1 — 功能性 bug 与健壮性

### P1-6 屏保闲置计时“清了不补”
- **问题**：交互节流窗（1 秒）内的每次交互都会清掉闲置计时器，但节流直接 return 不重排。鼠标连动超过 1 秒后停下，计时器处于“被清空且没人补”的状态——屏保永远不会自动进入。
- **修复**：节流窗内排一个「窗末补武装」计时器；顺带 `hideScreensaver()` 现在会清掉闲置计时与其补武装（退出后不残留自动进入，这由既有测试锁定）。
- **位置**：`src/site/screensaver.ts`

### P1-7 图集覆盖数据对 localStorage 不设防
- **问题**：`lumina.album.local` 里的内容直接 `JSON.parse` 后当对象用。存了 `"null"` / 数组 / 坏数据时 `Object.entries` 抛 TypeError，图集页整个白屏。
- **修复**：只接受纯对象，键值只留 null 与字符串，其余整体作废回退空表。
- **位置**：`src/site/useAlbums.ts`

### P1-8 设置持久化缺“切后台”冲刷
- **问题**：防抖 250ms 的设置保存只在 `pagehide` 冲刷；iOS Safari 等 tab 切后台只发 `visibilitychange`，设置可能丢最后一段。
- **修复**：补 `visibilitychange`(hidden) 冲刷，与 pagehide 幂等并存。
- **位置**：`src/site/settings.ts`

### P1-9 Manager 请求层四连
- **问题**：a) 保存/部署按钮的 loading 标志没有 try/finally，请求一抛错按钮永久卡在“保存中…”；b) `api()` 网络失败抛无信息量的 TypeError、非 JSON 响应抛 SyntaxError；c) 本地服务挂起时请求永不超时；d) 三个 Tab 各自并发调 `loadImages()`（v-show 导致四 Tab 同时挂载），同样的代理请求发 3 次、toast 弹 3 次。
- **修复**：try/finally 解锁；`api()` 归一化错误信息（可读中文）+ 10 秒超时；新增 `loadImagesShared()` 单飞共享（toast 只弹一次），三个 Tab 全部换用。
- **位置**：`src/manager/App.vue`、`src/manager/api.ts`、`FocalTab/AlbumTab/TagTab.vue`

### P1-10 四个 Tab 的顶栏按钮串台
- **问题**：Tab 主体用 `v-show`（同时挂载），每个 Tab 又都无条件 `<Teleport to="#bar-right">`——四个 Tab 的操作按钮同时挤在顶栏。
- **修复**：App 给每个 Tab 传 `active` prop，Teleport 只在自家 Tab 激活时渲染。
- **位置**：`src/manager/App.vue` + 四个 Tab 组件

### P1-11 SSE 日志按原始 JSON 串显示
- **问题**：服务端 log 事件发的是 `JSON.stringify(文本)`，客户端直接把整串（带引号和 `\n` 字面量）塞进日志面板。另外流中途断掉没有任何提示，AI 面板永远停在“运行中”。
- **修复**：log 事件解 JSON 后显示；读流循环加 try/catch，断流时 toast + 回调 done(false)。
- **位置**：`src/manager/api.ts`（runAi）

### P1-12 本地代理分页不封顶
- **问题**：Manager 的 `/api/proxy-images` 逐页拉到上游 `last_page` 为止，千张图 = 25+ 次上游请求；与生产 `images.js`（按 per_page 封顶页数）行为不一致。
- **修复**：对齐生产实现——页数由 `min(500, per_page)` 决定，返回前按该上限截断。
- **位置**：`tools/server/serve.mjs`

### P1-13 config-reader 的注释剥除正则会误伤字符串
- **问题**：解析数据文件前用 `/\*[\s\S]*?\*\//g` 全文剥块注释——这个正则不区分字符串内外，字符串里含 `/*` 的正常数据（如图集名、URL）会被静默删掉。而 acorn 本来就原生跳过注释，这一步纯属多余。
- **修复**：删除剥除步骤，acorn 直接解析（既有块注释用例仍然通过）。
- **位置**：`tools/server/lib/config-reader.mjs`

### P1-14 数据文件键的原型污染风险
- **问题**：解析/写回数据文件时用普通 `{}` 按外部键赋值，键为 `"__proto__"` 时会写到原型上（污染或静默丢失），键来自文件内容与 Manager 请求体。
- **修复**：四处汇总表（acorn 对象求值、albums 写回、tags 清洗/排序）全部改 `Object.create(null)`。
- **位置**：`tools/server/lib/config-reader.mjs`

---

## P2 — 性能与细节打磨

| 项 | 修复 | 位置 |
|---|---|---|
| 拖拽逐事件重渲染 | 高采样率指针的位移先累计，rAF 每帧落一次；松手时补齐余量防惯性回跳 | `HomeView.vue` |
| 闲置登记后台滞留 | 回前台时立即冲一次 pendingLoaded，不等下一帧 | `HomeView.vue` |
| 异步视图加载失败即白屏 | `defineAsyncComponent` 加 errorComponent（刷新重试按钮）+ 自动重试 2 次 + 150ms 延迟防闪烁 | `App.vue`、`base.css` |
| 错误横幅计时器泄漏 | 淡出窗口内再次弹出/手动关闭时，残留的内层计时器会把新横幅瞬间隐藏——内外计时器统一清理 | `useErrorBanner.ts` |
| 点赞回滚冲掉他人更新 | 失败回滚从「整表快照覆盖」改为只回滚本 url 的两条状态 | `src/site/likes.ts` |
| 下载链接协议注入 | 灯箱下载/新开目标只接受 http(s)，`javascript:` 一律不给 href | `Lightbox.vue` |
| 移动端点赞胶囊被压扁 | 响应式 40px 规则排除变宽的 `.lb-like` | `overrides.css` |
| content-visibility 估算失真 | `contain-intrinsic-size` 宽度跟随 `--card-w`（设置页可改） | `wall.css` |
| 图集卡片标签重复聚合 | 每卡调两次全量标签聚合 → 预计算成 Map | `GalleryView.vue` |
| preconnect 白连 | 图片是非 CORS 加载，`crossorigin` 的 preconnect 建的是另一条连接池 | `index.html` |
| 新窗口反链接劫持 | `window.open` 补 `noopener` | `AlbumTab/TagTab.vue` |
| 危险弹窗防手滑 | danger 确认框禁用 Enter 快捷确认（Esc/点按钮仍在） | `ConfirmModal.vue` |
| 死代码清理 | `.hidden` 死 CSS、`LoadResult.error` 恒 null 死字段 | `base.css`、`apiClient.ts` |
| AI 批量内存泄漏 | 解码 tensor 的 dispose 挪进 finally，detect 抛错也释放 | `tools/ai/build-focal-points.mjs` |

## 审查后核实为「无需修改」的项

- **灯箱键盘双监听（误报）**：`lbOnKey` 是模块级同一函数引用，`addEventListener` 天然去重，行为正确。
- **滚轮缩放合并注释（无误）**：由于 scale 恒在 [1,4] 区间内，逐步钳制与合并后一次钳制数学上等价，注释成立。
- **搜索框 aria-label / ConfigTab thumbWidth 提示**：核实时代码已具备，无需改动。

## 明确不做的项（需外部条件）

- visit/likes 接口限流 —— 需要 Cloudflare WAF 规则或 KV 计数，函数层单点做不经济。
- visitors 数据保留策略 —— 需要 Cron Triggers 定时清理。
- tools 测试 fixtures 与仓库真实数据文件解耦 —— 独立重构，另行安排。
