@echo off
cd /d "%~dp0"
echo ================================================
echo   Novel Studio is starting...
echo   After startup, open this page in your browser:
echo   http://127.0.0.1:8787
echo   Close this window to stop the server.
echo ================================================
python server.py
if errorlevel 1 (
  echo.
  echo Startup failed: port 8787 may be in use.
  echo Close old python windows, or check security software.
  pause
)
pause
