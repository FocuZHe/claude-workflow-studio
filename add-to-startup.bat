@echo off
echo ========================================
echo   Add to Startup
echo ========================================
echo.
echo [WARNING] This script modifies the Windows registry to enable auto-start.
echo Some antivirus software may flag this behavior. If you prefer, you can
echo manually create a shortcut in the Startup folder instead.
echo.
echo Continue? (Y/N)
set /p confirm=
if /i not "%confirm%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

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
