@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 一鍵啟動

rem 一律單行 + goto:多行 if(...) 區塊只要換行不是 CRLF 就會被 cmd 拆爛。

where docker >nul 2>nul
if errorlevel 1 goto :nodocker

rem 光有 docker 指令不代表引擎在跑。沒跑的話 docker compose 會噴
rem 「open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified」
rem 這種看不懂的訊息,所以這裡先確認引擎、必要時自動幫忙開起來。
echo [1/3] 檢查 Docker 引擎...
docker info >nul 2>nul
if not errorlevel 1 goto :setup

echo     Docker Desktop 沒有在執行,嘗試自動啟動...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" start "" "%LOCALAPPDATA%\Docker\Docker Desktop.exe"
set /a _wait=0

:waitdocker
docker info >nul 2>nul
if not errorlevel 1 goto :dockerup
set /a _wait+=1
if %_wait% GEQ 60 goto :dockerdead
echo     等待 Docker 引擎啟動中... (%_wait%/60)
timeout /t 3 /nobreak >nul
goto :waitdocker

:dockerup
echo     Docker 引擎已就緒。

:setup
echo [2/3] 檢查設定檔(第一次會自動產生密碼)...
powershell -NoProfile -ExecutionPolicy Bypass -File "windows\setup.ps1"
if errorlevel 1 goto :setupfail

echo [3/3] 啟動所有服務(第一次要下載映像,可能需要幾分鐘)...
docker compose up -d --build
if errorlevel 1 goto :upfail

echo.
echo 完成!
echo   查詢網站:http://localhost   (用瀏覽器打開)
echo   遊戲連線:你的IP:8211
echo.
start http://localhost
pause
exit /b 0

:nodocker
echo [X] 找不到 Docker!請先安裝 Docker Desktop:
echo     https://www.docker.com/products/docker-desktop/
echo     安裝完要把 Docker Desktop 打開,工作列出現鯨魚圖示才算啟動。
pause
exit /b 1

:dockerdead
echo.
echo [X] 等了 3 分鐘,Docker 引擎還是沒起來。請手動處理後重跑本檔:
echo     1. 從開始功能表打開「Docker Desktop」,等到工作列鯨魚圖示不再轉動
echo     2. 第一次安裝可能要求啟用 WSL 2 並重新開機,依畫面指示做完再開一次
echo     3. 若 Docker Desktop 卡在 Starting,右鍵鯨魚圖示 → Restart
echo     4. 都不行就重開機,再打開 Docker Desktop
pause
exit /b 1

:setupfail
echo [X] 設定產生失敗
pause
exit /b 1

:upfail
echo.
echo [X] 啟動失敗。若訊息裡出現 "dockerDesktopLinuxEngine" 或 "cannot find the file specified",
echo     代表 Docker 引擎中途停了 —— 打開 Docker Desktop 等它就緒後重跑本檔。
echo     其他錯誤請截圖上方訊息求助。
pause
exit /b 1
