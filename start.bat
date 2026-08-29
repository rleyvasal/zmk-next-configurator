@echo off
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 apps\web\serve.py
  goto :eof
)

where python >nul 2>nul
if not errorlevel 1 (
  python apps\web\serve.py
  goto :eof
)

echo Python 3 was not found. Install it from https://www.python.org/downloads/
pause
exit /b 1
