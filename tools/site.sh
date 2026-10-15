#!/usr/bin/env bash
# Lumina 站点本地预览 — 一键：装依赖 → build → wrangler pages dev → 开浏览器
#
# 与 tools/site.bat 同名同职责（Windows 版本），走和线上一致的数据链路：
#   wrangler pages dev 会同时提供 dist/ 静态资源与 functions/ 的 /api/images，
#   所以看到的是真实图床数据（纯 vite 只会有 16 张兜底占位图）。
#
# 用法：./tools/site.sh      按 Ctrl+C 停止
set -e
cd "$(dirname "$0")/.."

PORT=8001
URL="http://127.0.0.1:${PORT}/"

echo "============================================================"
echo "  Lumina 站点 — 本地预览（真实图片）"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[X] 未检测到 Node.js，请前往 https://nodejs.org 下载安装"
  exit 1
fi
echo "[1/4] Node.js 已就绪"

# functions/api/images.js 读 env.TOKEN 或 env.QUBU_TOKEN，缺了就只有兜底图
if [ ! -f .dev.vars ]; then
  echo "[X] 缺少 .dev.vars —— 图片代理拿不到 token，只会看到 16 张兜底占位图。"
  echo "    修复：在项目根目录建 .dev.vars，写一行  QUBU_TOKEN=你的token"
  echo "    然后重新运行本脚本。"
  exit 1
fi
echo "      .dev.vars 已就绪"

if [ ! -d node_modules ]; then
  echo "      首次运行，正在安装依赖（约 30-90 秒）"
  npm install --no-audit --no-fund --loglevel=error
else
  echo "      node_modules 已存在，跳过安装"
fi

echo "[2/4] 正在构建 dist/（约 5-15 秒）"
npm run build

# 后台等服务起来再开浏览器；.dev-tools 之类报错无所谓，打不开就手动访问
( sleep 10
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi ) >/dev/null 2>&1 &

echo "[3/4] 正在启动本地服务器：${URL}"
echo "      首次会下载 wrangler，可能要 1-3 分钟；按 Ctrl+C 停止"
echo
npx wrangler pages dev dist --port "${PORT}"

echo
echo "[4/4] 服务器已停止"
