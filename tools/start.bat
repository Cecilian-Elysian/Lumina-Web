@echo off
REM ============================================================
REM  Lumina Editor launcher
REM ------------------------------------------------------------
REM  Rules for this file (learned the hard way):
REM    1. MUST be CRLF  -- cmd.exe silently mis-parses LF-only .bat
REM    2. ASCII ONLY   -- cmd reads .bat with the system ANSI codepage
REM       (GBK on zh-CN). Chinese bytes get decoded into garbage and
REM       executed as commands. All Chinese UI text lives in Node
REM       output instead, where UTF-8 renders correctly.
REM    3. No parentheses or quotes inside REM comments.
REM ============================================================
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ============================================================
echo   Lumina Editor - local server
echo ============================================================
echo.

REM -- node detection: PATH first, then common install locations --
set "NODE_EXE=node"
set "PF86=%ProgramFiles(x86)%"
where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  if not exist "%ProgramFiles%\nodejs\node.exe" if exist "%PF86%\nodejs\node.exe" set "NODE_EXE=%PF86%\nodejs\node.exe"
  if not exist "%PF86%\nodejs\node.exe" if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
)

"%NODE_EXE%" -v >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js not found. Install it from https://nodejs.org
  echo     If it is already installed, make sure node.exe is on PATH.
  echo.
  pause
  exit /b 1
)
echo   - node: %NODE_EXE%

"%NODE_EXE%" server\serve.mjs %*
set "RC=%errorlevel%"

REM -- after exit: on failure dump the tail of the server log --
echo.
if not "%RC%"=="0" (
  echo [X] Server exited with code %RC%
  if exist ".tmp\serve.log" powershell -NoProfile -Command "Get-Content '.tmp\serve.log' -Tail 8 -Encoding UTF8"
) else (
  echo   Server stopped. Log: tools\.tmp\serve.log
)
echo.
pause
exit /b %RC%
