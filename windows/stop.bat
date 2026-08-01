@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title 帕魯伺服器 - 停止服務
echo 正在停止所有服務(遊戲會先存檔再關閉)...
docker compose stop
echo 已全部停止。要再開就雙擊「start.bat」。
pause
