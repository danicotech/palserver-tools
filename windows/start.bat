@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 一鍵啟動

rem 一律單行 + goto:多行 if(...) 區塊只要換行不是 CRLF 就會被 cmd 拆爛。

where docker >nul 2>nul
if errorlevel 1 goto :nodocker

echo [1/3] 檢查設定檔(第一次會自動產生密碼)...
powershell -NoProfile -ExecutionPolicy Bypass -File "windows\setup.ps1"
if errorlevel 1 goto :setupfail

echo [2/3] 啟動所有服務(第一次要下載映像,可能需要幾分鐘)...
docker compose up -d --build
if errorlevel 1 goto :upfail

echo [3/3] 完成!
echo.
echo   查詢網站:http://localhost   (用瀏覽器打開)
echo   遊戲連線:你的IP:8211
echo.
start http://localhost
pause
exit /b 0

:nodocker
echo [X] 找不到 Docker!請先安裝 Docker Desktop 並啟動它:
echo     https://www.docker.com/products/docker-desktop/
echo     安裝後要把 Docker Desktop 打開,工作列出現鯨魚圖示才算啟動。
pause
exit /b 1

:setupfail
echo [X] 設定產生失敗
pause
exit /b 1

:upfail
echo [X] 啟動失敗,請截圖上方訊息求助
pause
exit /b 1
