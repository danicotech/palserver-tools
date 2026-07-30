@echo off
REM ===== One-click start: build image + start scheduler stack =====
cd /d "%~dp0"
echo Starting Palworld scheduler stack (docker compose up -d --build)...
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo FAILED. Is Docker Desktop running?
    pause
    exit /b 1
)
echo.
docker compose ps
echo.
echo Done.
echo   - Control from terminal:  pal status   /  pal broadcast Hello   /  pal --help
echo   - Swagger UI:             http://localhost:9000/openapi/view
pause
