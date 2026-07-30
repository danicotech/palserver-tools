@echo off
REM ===== One-click stop: stop and remove the scheduler stack =====
cd /d "%~dp0"
echo Stopping Palworld scheduler stack (docker compose down)...
docker compose down
echo.
echo Stopped.
pause
