@echo off
echo ========================================
echo   Add to Startup
echo ========================================
echo.

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "MultiAgent" /t REG_SZ /d "\"%~dp0start.bat\"" /f >nul 2>&1

if errorlevel 1 (
    echo [ERROR] Failed to add to startup.
    echo Please run as administrator.
) else (
    echo Added to startup successfully!
    echo The service will start automatically on next boot.
)

echo.
echo Run remove-from-startup.bat to disable auto-start.
echo.
pause
