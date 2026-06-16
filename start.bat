@echo off
cd /d "%~dp0"

:: Add Node.js to PATH
set "PATH=%PATH%;C:\Program Files\nodejs"
set "DEFAULT_PORT=3456"
if not "%~1"=="" set "PORT=%~1"
if "%PORT%"=="" set "PORT=%DEFAULT_PORT%"

echo ========================================
echo   Multi-Agent Platform - Starting...
echo ========================================
echo   Port: %PORT%
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found! Please install Node.js 18+ first.
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

:: Check Claude Code CLI
where claude >nul 2>&1
if errorlevel 1 (
    echo [INFO] Claude Code CLI not found.
    echo SDK mode is available — configure API Key in Settings.
    echo To use CLI: npm install -g @anthropic-ai/claude-code
    echo.
)

:: Check and install dependencies
if not exist "node_modules" (
    echo [!] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed!
        echo If node-pty build failed, you may need:
        echo   - Python 3 (npm install -g windows-build-tools)
        echo   - Visual Studio Build Tools
        echo.
        pause
        exit /b 1
    )
    echo.
) else (
    :: Check if native module node-pty is compiled
    if not exist "node_modules\node-pty\build" (
        echo [!] node-pty not compiled, rebuilding...
        call npm rebuild node-pty
        if errorlevel 1 (
            echo.
            echo [ERROR] node-pty rebuild failed!
            echo You may need Python 3 and Visual Studio Build Tools.
            echo Run: npm install -g windows-build-tools
            echo.
            pause
            exit /b 1
        )
        echo.
    )
)

:: Build TypeScript
echo [0/4] Building TypeScript...
call npm run build >nul 2>&1
if errorlevel 1 (
    echo [WARNING] TypeScript build failed, using existing dist/ files...
) else (
    echo     Build complete.
)
echo.

:: Kill old PM2 daemon
echo [1/4] Resetting PM2 daemon...
call npx pm2 kill >nul 2>&1

:: Start PM2 daemon
echo [2/4] Starting PM2 daemon...
call npx pm2 update >nul 2>&1

:: Clean old processes
echo [3/4] Cleaning old processes...
call npx pm2 delete claude-console >nul 2>&1

:: Start service
echo [4/4] Starting service...
call npx pm2 start dist/server/app.js --name claude-console --update-env
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start service!
    echo Please check if Node.js is installed.
    echo.
    pause
    exit /b 1
)

call npx pm2 save >nul 2>&1

echo.
echo ========================================
echo   Service started successfully!
echo   Visit http://localhost:%PORT%
echo   Run stop.bat to stop the service
echo ========================================
echo.
pause
