@echo off
cd /d "%~dp0"
echo ========================================
echo   Viewing PM2 Logs
echo ========================================
echo.
echo 实时日志 (Ctrl+C 退出):
echo.
npx pm2 logs claude-console --lines 50
