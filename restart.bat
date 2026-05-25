@echo off
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"

echo ========================================
echo   Restarting Service...
echo ========================================
echo.

:: Save logs before restart
if not exist "logs" mkdir logs
set "PM2_LOG_DIR=%USERPROFILE%\.pm2\logs"
if exist "%PM2_LOG_DIR%\claude-console-out.log" copy /Y "%PM2_LOG_DIR%\claude-console-out.log" "logs\claude-console-out.log" >nul 2>&1
if exist "%PM2_LOG_DIR%\claude-console-error.log" copy /Y "%PM2_LOG_DIR%\claude-console-error.log" "logs\claude-console-error.log" >nul 2>&1

echo Stopping...
call npx pm2 stop claude-console >nul 2>&1
call npx pm2 delete claude-console >nul 2>&1

echo Starting...
call npx pm2 start src/server/app.js --name claude-console

echo.
echo ========================================
call npx pm2 status
echo ========================================
echo.
echo Service restarted!
echo.
pause
