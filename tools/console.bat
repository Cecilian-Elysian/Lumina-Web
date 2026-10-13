@echo off
REM ============================================================
REM  Lumina Manager - open console in browser with DevTools
REM ------------------------------------------------------------
REM  Usage:
REM    1. tools\console.bat  - needs server already running
REM    2. tools\dev.bat      - one shot: start server + open browser
REM
REM  ASCII ONLY + CRLF required: see rules in start.bat header.
REM ============================================================
chcp 65001 >nul 2>&1
cd /d "%~dp0"

setlocal EnableDelayedExpansion

set PORT=8002
REM Use the port the server actually bound: serve.mjs falls back to
REM 8003+ when 8002 is taken and writes the real port to port.txt.
if exist "%~dp0.tmp\port.txt" set /p PORT=<"%~dp0.tmp\port.txt"
set URL=http://127.0.0.1:%PORT%/manager/

echo.
echo ============================================================
echo   Lumina Manager + DevTools launcher
echo ============================================================
echo.

netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
  echo [1/2] Nothing listening on port %PORT%
  echo   - Start the server first: tools\start.bat
  echo   - Or use the one-shot launcher: tools\dev.bat
  echo.
  pause
  exit /b 1
)
echo [1/2] Server detected on port %PORT%

set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_PATH!" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE_PATH!" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo.
echo [2/2] Opening browser with DevTools

if exist "!CHROME_PATH!" (
  echo   - Using Chrome
  start "" "!CHROME_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

if exist "!EDGE_PATH!" (
  echo   - Chrome not found, using Edge
  start "" "!EDGE_PATH!" --auto-open-devtools-for-tabs "!URL!"
  goto DONE
)

echo   - Chrome / Edge not found, using default browser
echo   - Press F12 to open DevTools
start "" "!URL!"

:DONE
echo.
echo   URL: !URL!
timeout /t 2 /nobreak >nul
endlocal
exit /b 0
