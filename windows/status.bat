@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 狀態

docker info >nul 2>nul
if errorlevel 1 goto :enginedown
echo ================= 服務狀態 =================
docker compose ps
echo.
echo ============== 排程器最近日誌 ==============
docker compose logs --tail 20 scheduler
pause
exit /b 0

:enginedown
echo [X] Docker 引擎沒在跑(Docker Desktop 未啟動或還在啟動中),看不到服務狀態。
echo     打開 Docker Desktop、等工作列鯨魚圖示不再轉動,再重跑本檔。
pause
exit /b 1
