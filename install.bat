@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

set "LOG_FILE=%~dp0install.log"
echo [%time%] install.bat started > "%LOG_FILE%"

set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%PATH%;%NODE_PATH%;%APPDATA%\npm;%USERPROFILE%\AppData\Roaming\npm"

echo.
echo   ==========================================
echo     Multi-Agent Collaboration Platform
echo     One-Click Installation
echo   ==========================================
echo.

rem --- 1. Check Node.js ---
echo   [1/6] Checking Node.js...
echo [%time%] [1/6] Checking Node.js... >> "%LOG_FILE%"

where node >nul 2>&1
if errorlevel 1 goto :err_no_node
echo [%time%] where node OK >> "%LOG_FILE%"

node -v > "%TEMP%\node-ver.txt" 2>&1
if errorlevel 1 goto :err_node_v
set /p NODE_VER=<"%TEMP%\node-ver.txt"
echo     Node.js: %NODE_VER%
echo [%time%] Node.js: %NODE_VER% >> "%LOG_FILE%"
del "%TEMP%\node-ver.txt" >nul 2>&1

call npm -v > "%TEMP%\npm-ver.txt" 2>&1
if errorlevel 1 goto :err_npm_v
set /p NPM_VER=<"%TEMP%\npm-ver.txt"
echo     npm:      v%NPM_VER%
echo [%time%] npm: v%NPM_VER% >> "%LOG_FILE%"
del "%TEMP%\npm-ver.txt" >nul 2>&1

echo.

rem --- 2. Install npm dependencies ---
echo   [2/6] Installing dependencies...
echo [%time%] [2/6] Installing dependencies... >> "%LOG_FILE%"

if not exist "node_modules" goto :install_fresh
goto :install_update

:install_fresh
echo     Running npm install (first time, may take a while)...
echo.
echo [%time%] Running: npm install (fresh) >> "%LOG_FILE%"
call npm install --no-audit --no-fund
goto :check_install_result

:install_update
echo     node_modules exists, checking for updates...
echo.
echo [%time%] Running: npm install (update) >> "%LOG_FILE%"
call npm install --no-audit --no-fund
goto :check_install_result

:check_install_result
echo [%time%] npm install exit code: %errorlevel% >> "%LOG_FILE%"
if errorlevel 1 goto :err_npm_install

echo.
echo     Dependencies installed.
echo [%time%] npm install OK >> "%LOG_FILE%"
echo.

rem --- 3. Verify PM2 ---
echo   [3/6] Checking PM2 process manager...
echo [%time%] [3/6] Checking PM2... >> "%LOG_FILE%"

where pm2 >nul 2>&1
if not errorlevel 1 goto :pm2_ok

if exist "node_modules\.bin\pm2" goto :pm2_ok
if exist "node_modules\.bin\pm2.cmd" goto :pm2_ok

echo     PM2 not found, installing...
echo [%time%] PM2 not found, installing... >> "%LOG_FILE%"
call npm install pm2 --no-audit --no-fund --save
if errorlevel 1 (
    echo   [WARNING] PM2 install failed!
    echo     start.bat / stop.bat may not work.
    echo [%time%] [WARNING] PM2 install failed >> "%LOG_FILE%"
) else (
    echo     PM2 installed.
    echo [%time%] PM2 installed >> "%LOG_FILE%"
)
goto :step_4

:pm2_ok
echo     PM2 is available.
echo [%time%] PM2 is available >> "%LOG_FILE%"

:step_4
echo.

rem --- 4. Verify native modules ---
echo   [4/6] Checking native modules...
echo [%time%] [4/6] Checking native modules... >> "%LOG_FILE%"

if exist "node_modules\node-pty\build" goto :pty_ok

echo     Rebuilding node-pty (native module)...
echo     This may take a moment...
echo [%time%] Running: npm rebuild node-pty >> "%LOG_FILE%"
call npm rebuild node-pty --no-audit --no-fund
if errorlevel 1 goto :warn_pty_fail
echo     node-pty compiled successfully.
echo [%time%] node-pty rebuild OK >> "%LOG_FILE%"
goto :step_4

:warn_pty_fail
echo.
echo   [WARNING] node-pty rebuild failed!
echo     Terminal feature will not work.
echo     To fix, install build tools:
echo       npm install -g windows-build-tools
echo       OR install Visual Studio 2022 with "Desktop C++"
echo.
echo     Continuing anyway...
echo [%time%] [WARNING] node-pty rebuild failed >> "%LOG_FILE%"
goto :step_4

:pty_ok
echo     node-pty already compiled.
echo [%time%] node-pty already compiled >> "%LOG_FILE%"

:step_4
echo.

rem --- 5. Check Claude Code CLI ---
echo   [5/6] Checking Claude Code CLI...
echo [%time%] [5/6] Checking Claude Code CLI... >> "%LOG_FILE%"

where claude >nul 2>&1
if errorlevel 1 goto :warn_no_claude

call claude --version > "%TEMP%\claude-ver.txt" 2>&1
set /p CLAUDE_VER=<"%TEMP%\claude-ver.txt"
echo     !CLAUDE_VER!
echo [%time%] Claude CLI: !CLAUDE_VER! >> "%LOG_FILE%"
del "%TEMP%\claude-ver.txt" >nul 2>&1
goto :step_5

:warn_no_claude
echo   [WARNING] Claude Code CLI not found!
echo     SDK mode is available — configure your API Key
echo     in Settings after installation.
echo.
echo     To use CLI mode, install:
echo       npm install -g @anthropic-ai/claude-code
echo.
echo [%time%] Claude CLI not found >> "%LOG_FILE%"

:step_5
echo.

rem --- 5. Initialize project directories ---
echo   [6/6] Initializing project directories...
echo [%time%] [6/6] Initializing project directories... >> "%LOG_FILE%"

if not exist "data" (
    mkdir data >nul 2>&1
    echo     Created: data/
    echo [%time%] Created: data/ >> "%LOG_FILE%"
)
if not exist "logs" (
    mkdir logs >nul 2>&1
    echo     Created: logs/
    echo [%time%] Created: logs/ >> "%LOG_FILE%"
)
if not exist "workspace" (
    mkdir workspace >nul 2>&1
    echo     Created: workspace/
    echo [%time%] Created: workspace/ >> "%LOG_FILE%"
)
echo.

rem --- Done ---
echo   ==========================================
echo     Installation complete!
echo   ==========================================
echo.
echo     Start the platform:
echo       start.bat     - Start service (PM2 daemon)
echo       npm start     - Direct start (port 3000)
echo       npm run dev   - Dev mode (auto-restart)
echo.
echo     Stop the platform:
echo       stop.bat      - Stop service and save logs
echo.
echo     Web: http://localhost:3000
echo.
echo   ==========================================
echo.
echo [%time%] Install completed successfully >> "%LOG_FILE%"
pause
endlocal
exit /b 0

rem =============================================
rem   Error handlers
rem =============================================

:err_no_node
echo   [ERROR] Node.js not found!
echo [%time%] [ERROR] where node failed >> "%LOG_FILE%"
echo.
echo   Please install Node.js 18+ first:
echo     https://nodejs.org/
echo.
pause
exit /b 1

:err_node_v
echo   [ERROR] node -v failed!
echo [%time%] [ERROR] node -v failed >> "%LOG_FILE%"
type "%TEMP%\node-ver.txt" >> "%LOG_FILE%" 2>nul
pause
exit /b 1

:err_npm_v
echo   [ERROR] npm -v failed!
echo [%time%] [ERROR] npm -v failed >> "%LOG_FILE%"
type "%TEMP%\npm-ver.txt" >> "%LOG_FILE%" 2>nul
pause
exit /b 1

:err_npm_install
echo.
echo   ==========================================
echo   [ERROR] npm install failed!
echo   ==========================================
echo [%time%] [ERROR] npm install failed, errorlevel=%errorlevel% >> "%LOG_FILE%"
echo.
echo   Check install.log in this folder for details.
echo.
pause
exit /b 1
