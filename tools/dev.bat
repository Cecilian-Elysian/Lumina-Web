@echo off
REM ============================================================
REM  Lumina one-shot launcher: start server + wait + open browser
REM ------------------------------------------------------------
REM  ASCII ONLY + CRLF required: see rules in start.bat header.
REM ============================================================
chcp 65001 >nul 2>&1
cd /d "%~dp0\.."

setlocal EnableDelayedExpansion

set PORT=8002
REM Use the port the server actually bound: serve.mjs falls back to
REM 8003+ when 8002 is taken and writes the real port to port.txt.
if exist "%~dp0.tmp\port.txt" set /p PORT=<"%~dp0.tmp\port.txt"
set URL=http://127.0.0.1:%PORT%/manager/

echo.
echo ============================================================
echo   Lumina one-shot launcher
echo ============================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [X] Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "tools\node_modules" (
  echo [1/4] First run, installing deps - about 30-90s
  call npm install --prefix tools --no-audit --no-fund --loglevel=error
  if !errorlevel! neq 0 (
    echo [X] Install failed. Run manually: npm install --prefix tools
    echo.
    pause
    exit /b 1
  )
  echo   - Deps ready
) else (
  echo [1/4] tools\node_modules found, skipping install
)

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto SERVER_RUNNING
echo [2/4] Port %PORT% is free, starting server
start "Lumina Server" /B cmd /c "node tools\server\serve.mjs --no-launch --no-install --port=%PORT%"
echo   - Waiting for the server - timeout 30s
set WAIT_COUNT=0
goto WAIT_LOOP

:SERVER_RUNNING
echo [2/4] Server already running, skip start
goto SKIP_WAIT

:WAIT_LOOP
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto SERVER_READY
if %WAIT_COUNT% lss 30 goto WAIT_LOOP
echo [X] Server start timed out after 30s
echo     Check tools\.tmp\serve.log for details
echo.
pause
exit /b 1

:SERVER_READY
echo   - Server is ready

:SKIP_WAIT

set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE_PATH!" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo.
echo [3/4] Picking a browser

if exist "!CHROME_PATH!" (
  echo   - Using Chrome
  goto LAUNCH_CHROME
)

if exist "!EDGE_PATH!" (
  echo   - Chrome not found, using Edge
  goto LAUNCH_EDGE
)

echo   - Chrome / Edge not found, using default browser
echo   - Press F12 to open DevTools
start "" "!URL!"
goto DONE

:LAUNCH_CHROME
start "" "!CHROME_PATH!" --auto-open-devtools-for-tabs "!URL!"
goto DONE

:LAUNCH_EDGE
start "" "!EDGE_PATH!" --auto-open-devtools-for-tabs "!URL!"

:DONE
echo [4/4] Opened !URL!
echo.
echo ============================================================
echo   Notes:
echo   - Press F12 to toggle DevTools
echo   - Closing this window does not stop the server
echo   - To stop it: close the original start.bat window
echo     or end node.exe in Task Manager
echo   - Log: tools\.tmp\serve.log
echo ============================================================
echo.
timeout /t 3 /nobreak >nul
endlocal
exit /b 0
