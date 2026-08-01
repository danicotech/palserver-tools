@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title 帕魯伺服器 - 狀態
echo ================= 服務狀態 =================
docker compose ps
echo.
echo ============== 排程器最近日誌 ==============
docker compose logs --tail 20 scheduler
pause
