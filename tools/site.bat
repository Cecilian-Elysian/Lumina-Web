@echo off
REM ============================================================
REM  Lumina site launcher - one shot: build + wrangler + browser
REM ------------------------------------------------------------
REM  Shows REAL images, same data path as production:
REM    1. preflight: node / .dev.vars / node_modules
REM    2. npm run build                  -> dist/
REM    3. npx wrangler pages dev dist    -> serves dist/ + functions/
REM    4. open Chrome/Edge with DevTools  -> http://127.0.0.1:8001/
REM
REM  Rules for this file (learned the hard way):
REM    1. MUST be CRLF  -- cmd.exe silently mis-parses LF-only .bat
REM    2. ASCII ONLY   -- cmd reads .bat with the system ANSI codepage
REM       (GBK on zh-CN). Chinese bytes get decoded into garbage and
REM       executed as commands. See rules in start.bat header.
REM    3. No parentheses or quotes inside REM comments.
REM
REM  Re-running is safe: if port 8001 already listens, this only
REM  reopens the browser instead of starting a second server.
REM ============================================================
chcp 65001 >nul 2>&1
cd /d "%~dp0\.."

setlocal EnableDelayedExpansion

set PORT=8001
set URL=http://127.0.0.1:%PORT%/

echo.
echo ============================================================
echo   Lumina site - local preview with real images
echo ============================================================
echo.

REM ---------- [1/4] preflight ----------
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [X] Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo [1/4] Node.js found

REM functions/api/images.js reads env.TOKEN or env.QUBU_TOKEN.
REM Without it the proxy fails and you only get fallback images.
if not exist ".dev.vars" (
  echo [X] .dev.vars is missing - the image proxy has no token, so you
  echo     would see only the 16 fallback placeholder images.
  echo     Fix: create .dev.vars in the project root with one line
  echo          QUBU_TOKEN=your-token
  echo     Then run this file again.
  echo.
  pause
  exit /b 1
)
echo       .dev.vars found

if not exist "node_modules" (
  echo       First run - installing deps, about 30-90s
  call npm install --no-audit --no-fund --loglevel=error
  if !errorlevel! neq 0 (
    echo [X] Install failed. Run manually: npm install
    echo.
    pause
    exit /b 1
  )
  echo       - Deps ready
) else (
  echo       node_modules found, skipping install
)

REM ---------- is the server already up? ----------
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto SERVER_RUNNING

REM ---------- [2/4] build ----------
echo [2/4] Building dist/ - about 5-15s
call npm run build
if !errorlevel! neq 0 (
  echo [X] Build failed. Run manually: npm run build
  echo.
  pause
  exit /b 1
)
echo       - dist/ is up to date

REM ---------- [3/4] start wrangler ----------
echo [3/4] Port %PORT% is free, starting wrangler pages dev
echo       - The server runs in its own window - keep it open.
echo       - First run downloads wrangler, may take 1-3 minutes.
start "Lumina Site" cmd /c "npx wrangler pages dev dist --port %PORT%"
echo       - Waiting for the server - timeout 180s
powershell -NoProfile -Command "$d=180; while($d -gt 0){ if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 0}; Start-Sleep -Seconds 1; $d-- }; exit 1" >nul 2>&1
if !errorlevel! neq 0 goto SERVER_TIMEOUT
echo       - Server is ready
goto OPEN_BROWSER

:SERVER_RUNNING
echo [2/4] Server already running on port %PORT%, skipping build
echo [3/4] Reusing the running server
goto OPEN_BROWSER

:SERVER_TIMEOUT
echo [X] Server did not start within 180s
echo     - Look at the "Lumina Site" window for the real reason
echo     - First run needs internet to download wrangler
echo     - If wrangler asks you to log in, run: npx wrangler login
echo.
pause
exit /b 1

:OPEN_BROWSER
REM ---------- [4/4] browser ----------
echo.
echo [4/4] Picking a browser

set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE_PATH!" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "!CHROME_PATH!" (
  echo       - Using Chrome
  start "" "!CHROME_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

if exist "!EDGE_PATH!" (
  echo       - Chrome not found, using Edge
  start "" "!EDGE_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

echo       - Chrome / Edge not found, using default browser
echo       - Press F12 to open DevTools
start "" "!URL!"

:DONE
echo.
echo ============================================================
echo   URL: !URL!
echo   Notes:
echo   - Real images: /api/images must be 200 in the Network tab
echo   - The server lives in the "Lumina Site" window
echo   - To stop it: close that window, or press Ctrl+C inside it
echo   - Changes to src/ need a rebuild: run this file again
echo ============================================================
echo.
pause
endlocal
exit /b 0
