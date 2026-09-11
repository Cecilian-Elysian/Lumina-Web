@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ============================================================
echo   Lumina 编辑器
echo ============================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [X] 未检测到 Node.js，请前往 https://nodejs.org 下载安装
  echo.
  pause
  exit /b 1
)

node server\serve.mjs %*

pause