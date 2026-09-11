@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0\.."

setlocal EnableDelayedExpansion

REM ============================================================
REM  Lumina 管理器 + DevTools 快捷启动
REM ------------------------------------------------------------
REM  用法:
REM    1. 单独运行:tools/console.bat
REM       - 假设服务已在 8002 端口运行(否则提示启动 start.bat)
REM    2. 一站式:tools/dev.bat(启动服务 + 等待 + 打开浏览器)
REM ============================================================

set URL=http://127.0.0.1:8002/manager/
set PORT=8002

echo.
echo ============================================================
echo   Lumina 管理器 + DevTools 快捷启动
echo ============================================================
echo.

REM ── 检测服务是否在跑 ──
netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
  echo [1/2] 端口 %PORT% 未监听
  echo   - 请先双击 tools\start.bat 启动服务
  echo   - 或运行 tools\dev.bat 一键启动
  echo.
  pause
  exit /b 1
)
echo [1/2] 检测到服务已在 %PORT% 端口运行

REM ── 检测浏览器 ──
set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE_PATH!" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo.
echo [2/2] 打开浏览器(DevTools 自动开启)

if exist "!CHROME_PATH!" (
  echo   - 使用 Chrome
  start "" "!CHROME_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

if exist "!EDGE_PATH!" (
  echo   - Chrome 未找到,使用 Edge
  start "" "!EDGE_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

echo   - 未找到 Chrome / Edge,使用系统默认浏览器
echo   - 请手动按 F12 打开 DevTools
start "" "!URL!"

:DONE
echo.
echo 完成。
timeout /t 2 /nobreak >nul
exit /b 0