@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 帕魯伺服器 - 一鍵啟動
call "%~dp0native\ui.bat" "帕魯伺服器全家桶 · 一鍵啟動" "有 Docker 走 Docker 版;沒有就自動改用 SteamCMD 版"

rem 一律單行 + goto:多行 if(...) 區塊只要換行不是 CRLF 就會被 cmd 拆爛。
rem 流程:有 Docker 就跑 Docker 版(四個容器);
rem       沒有 Docker 就自動改跑 SteamCMD 版全套(遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站)。

where docker >nul 2>nul
if errorlevel 1 goto :nodocker

rem 光有 docker 指令不代表引擎在跑。沒跑的話 docker compose 會噴
rem 「open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified」
rem 這種看不懂的訊息,所以這裡先確認引擎、必要時自動幫忙開起來。
echo %T%[1/3]%R% 檢查 Docker 引擎...
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
if %_wait% GEQ 40 goto :dockerdead
echo     等待 Docker 引擎啟動中... (%_wait%/40)
timeout /t 3 /nobreak >nul
goto :waitdocker

:dockerup
echo     Docker 引擎已就緒。

:setup
echo %T%[2/3]%R% 檢查設定檔(第一次會自動產生密碼)...
call "windows\setup.bat"
if errorlevel 1 goto :setupfail

echo %T%[3/3]%R% 啟動所有服務(第一次要下載映像,可能需要幾分鐘)...
docker compose up -d --build
if errorlevel 1 goto :upfail

echo.
echo %G%完成!%R%
echo   查詢網站:%K%http://localhost%R%   (用瀏覽器打開)
echo   遊戲連線:%K%你的IP:8211%R%
echo.
start http://localhost
pause
exit /b 0

:nodocker
echo.
echo 這台電腦沒有 Docker。
echo 沒關係 —— 改用「SteamCMD 版」一樣可以跑完整服務:
echo   遊戲伺服器 + 排程開關服 + 存檔解析 + 查詢網站(只是不透過容器)。
echo.
choice /c YN /n /m "要現在改用 SteamCMD 版嗎?(Y=好 / N=我要先裝 Docker) "
if errorlevel 2 goto :installdocker
echo.
call "%~dp0native\start-all.bat"
exit /b %errorlevel%

:installdocker
echo.
echo 請安裝 Docker Desktop 後再重跑本檔:
echo     https://www.docker.com/products/docker-desktop/
echo     安裝完要把它打開,工作列出現鯨魚圖示才算啟動。
pause
exit /b 1

:dockerdead
echo.
echo %X%[X]%R% 等了 2 分鐘,Docker 引擎還是沒起來。
echo     可以先手動處理(打開 Docker Desktop、等鯨魚圖示不再轉動、必要時啟用 WSL 2 並重開機),
echo     或者直接改用不需要 Docker 的 SteamCMD 版。
echo.
choice /c YN /n /m "要改用 SteamCMD 版嗎?(Y=好 / N=我自己處理 Docker) "
if errorlevel 2 goto :giveup
call "%~dp0native\start-all.bat"
exit /b %errorlevel%

:giveup
echo 好的,處理完 Docker 後重跑本檔即可。
pause
exit /b 1

:setupfail
echo %X%[X]%R% 設定產生失敗
pause
exit /b 1

:upfail
echo.
echo %X%[X]%R% 啟動失敗。若訊息裡出現 "dockerDesktopLinuxEngine" 或 "cannot find the file specified",
echo     代表 Docker 引擎中途停了 —— 打開 Docker Desktop 等它就緒後重跑本檔。
echo     其他錯誤請截圖上方訊息求助。
pause
exit /b 1
