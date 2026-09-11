@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0\.."

setlocal EnableDelayedExpansion

REM ============================================================
REM  Lumina 一站式启动 (server + browser)
REM ------------------------------------------------------------
REM  1. 检查并启动本地 server (8002)
REM  2. 等待端口就绪
REM  3. 打开 Chrome / Edge + DevTools
REM ============================================================

set URL=http://127.0.0.1:8002/manager/
set PORT=8002

echo.
echo ============================================================
echo   Lumina 一站式启动
echo ============================================================
echo.

REM ── 检查 Node.js ──
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [X] 未检测到 Node.js,请前往 https://nodejs.org 下载安装
  echo.
  pause
  exit /b 1
)

REM ── 检查依赖 (tools/node_modules) ──
if not exist "tools\node_modules" (
  echo [1/4] 首次运行,安装依赖(约 30-90 秒)
  call npm install --prefix tools --no-audit --no-fund --loglevel=error
  if !errorlevel! neq 0 (
    echo [X] 依赖安装失败,请检查网络或手动运行: npm install --prefix tools
    echo.
    pause
    exit /b 1
  )
  echo   - 依赖已就绪
) else (
  echo [1/4] 检测到 tools\node_modules 已就位,跳过依赖安装
)

REM ── 检查服务是否已在跑 ──
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto SERVER_RUNNING
echo [2/4] 端口 %PORT% 未监听,启动 server
start "Lumina Server" /B cmd /c "node tools\server\serve.mjs --no-launch --no-install --port=%PORT%"
echo   - 等待服务就绪(超时 30 秒)
set WAIT_COUNT=0
goto WAIT_LOOP

:SERVER_RUNNING
echo [2/4] 检测到服务已在运行,跳过启动
goto SKIP_WAIT

:WAIT_LOOP
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto SERVER_READY
if %WAIT_COUNT% lss 30 goto WAIT_LOOP
echo [X] 服务启动超时 (30 秒),请查看 tools\.tmp\serve.err
echo.
pause
exit /b 1

:SERVER_READY
echo   - 服务已就绪

:SKIP_WAIT

REM ── 检测浏览器 ──
set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE_PATH!" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo.
echo [3/4] 选择浏览器

if exist "!CHROME_PATH!" (
  echo   - 使用 Chrome
  goto LAUNCH_CHROME
)

if exist "!EDGE_PATH!" (
  echo   - Chrome 未找到,使用 Edge
  goto LAUNCH_EDGE
)

echo   - 未找到 Chrome / Edge,使用系统默认浏览器
echo   - 请手动按 F12 打开 DevTools
start "" "!URL!"
goto DONE

:LAUNCH_CHROME
start "" "!CHROME_PATH!" --auto-open-devtools-for-tabs "!URL!"
goto DONE

:LAUNCH_EDGE
start "" "!EDGE_PATH!" --auto-open-devtools-for-tabs "!URL!"

:DONE
echo [4/4] 已打开 !URL!
echo.
echo ============================================================
echo   提示:
echo   - 按 F12 切换 DevTools(或浏览器启动时已自动开)
echo   - 关闭此窗口不影响 server(后台运行)
echo   - 想停 server:在任务管理器结束 node.exe 或关闭原始 start.bat 窗口
echo ============================================================
echo.
timeout /t 3 /nobreak >nul
exit /b 0