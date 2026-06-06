@echo off
cd /d "%~dp0"

:: Add Node.js to PATH
set "PATH=%PATH%;C:\Program Files\nodejs"

echo ========================================
echo   Multi-Agent Platform - Stopping...
echo ========================================
echo.

:: 1. Save PM2 logs before stopping
echo [1/4] Saving console logs...
if not exist "logs" mkdir logs
set "PM2_LOG_DIR=%USERPROFILE%\.pm2\logs"
if exist "%PM2_LOG_DIR%\claude-console-out.log" (
    copy /Y "%PM2_LOG_DIR%\claude-console-out.log" "logs\claude-console-out.log" >nul 2>&1
)
if exist "%PM2_LOG_DIR%\claude-console-error.log" (
    copy /Y "%PM2_LOG_DIR%\claude-console-error.log" "logs\claude-console-error.log" >nul 2>&1
)
if not exist "%PM2_LOG_DIR%\claude-console-out.log" if not exist "%PM2_LOG_DIR%\claude-console-error.log" (
    echo   - No running PM2 process logs
)

:: 2. Stop the PM2 process gracefully
echo [2/4] Stopping service...
call npx pm2 stop claude-console
if errorlevel 1 (
    echo   [WARN] pm2 stop failed, process may not be running.
)
echo.

:: 3. Remove from PM2 process list
echo [3/4] Cleaning up...
call npx pm2 delete claude-console >nul 2>&1

:: 4. Kill PM2 daemon
echo [4/4] Stopping PM2 daemon...
call npx pm2 kill >nul 2>&1
echo.

echo ========================================
echo   Service stopped successfully!
echo   Logs saved to: logs\claude-console-*.log
echo ========================================
echo.
pause
