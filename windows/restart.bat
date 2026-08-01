@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 重啟服務

where docker >nul 2>nul
if errorlevel 1 goto :nodocker
docker info >nul 2>nul
if errorlevel 1 goto :enginedown

echo 正在重啟所有服務(套用 .env / config.json 的新設定)...
docker compose up -d --build
if errorlevel 1 goto :fail
echo 完成!網站:http://localhost
pause
exit /b 0

:nodocker
echo [X] 找不到 Docker,請先安裝並打開 Docker Desktop:
echo     https://www.docker.com/products/docker-desktop/
pause
exit /b 1

:enginedown
echo [X] Docker 引擎沒在跑(Docker Desktop 未啟動或還在啟動中)。
echo     打開 Docker Desktop、等工作列鯨魚圖示不再轉動,再重跑本檔。
pause
exit /b 1

:fail
echo [X] 重啟失敗,請截圖上方訊息求助。
pause
exit /b 1
