@echo off
echo ========================================
echo   Remove from Startup
echo ========================================
echo.

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "MultiAgent" /f >nul 2>&1

echo Removed from startup.
echo.
pause
