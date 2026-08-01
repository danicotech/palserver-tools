@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 帕魯伺服器 - 重啟服務
echo 正在重啟所有服務(套用 .env / config.json 的新設定)...
docker compose up -d --build
if errorlevel 1 ( echo [X] 重啟失敗 & pause & exit /b 1 )
echo 完成!網站:http://localhost
pause
