@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 停止服務

docker info >nul 2>nul
if errorlevel 1 goto :enginedown
echo 正在停止所有服務(遊戲會先存檔再關閉)...
docker compose stop
echo 已全部停止。要再開就雙擊「start.bat」。
pause
exit /b 0

:enginedown
echo Docker 引擎沒在跑,代表服務本來就沒開著(不用停)。
echo 若你只是想關掉 Docker Desktop,直接右鍵鯨魚圖示 → Quit 即可。
pause
exit /b 0
