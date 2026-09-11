#!/usr/bin/env bash
# Lumina 编辑器 — Unix/macOS 一键启动
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  Lumina 编辑器"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[X] 未检测到 Node.js，请前往 https://nodejs.org 下载安装"
  exit 1
fi

node server/serve.mjs "$@"