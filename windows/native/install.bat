@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
set "ROOT=%CD%"
set "NATIVE=%ROOT%\windows\native"
rem 伺服器安裝位置:預設 windows\native\server;
rem 舊版(1.0.2 以前)裝在 windows\server,偵測到就沿用,免得重下 6 GB。
set "SRVDIR=%NATIVE%\server"
if exist "%ROOT%\windows\server\PalServer.exe" set "SRVDIR=%ROOT%\windows\server"
title Palworld SteamCMD 版 - 一次裝好全部

rem 這支把「跑起完整服務」需要的東西一次裝完:
rem   SteamCMD → 遊戲伺服器 → Python(存檔解析)→ Node(建網站)→ Go(排程器)
rem   → 建置查詢網站 → 編譯排程器 → 產生設定檔
rem 裝完直接雙擊 start-all.bat 就有完整服務。
rem 一律單行 + goto:多行 if(...) 區塊只要換行不是 CRLF 就會被 cmd 拆爛。

echo ============================================================
echo   Palworld SteamCMD 版:一次裝好(不需要 Docker)
echo   裝完雙擊 windows\native\start-all.bat 就能開服 + 開網站
echo ============================================================
echo.

rem ---------- 1. SteamCMD ----------
echo [1/7] SteamCMD...
if exist "%NATIVE%\steamcmd\steamcmd.exe" goto :hassteamcmd
if exist "%NATIVE%\steamcmd.zip" del /f /q "%NATIVE%\steamcmd.zip"
curl -L --fail -o "%NATIVE%\steamcmd.zip" "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
if errorlevel 1 goto :dlfail
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath '%NATIVE%\steamcmd.zip' -DestinationPath '%NATIVE%\steamcmd'"
if errorlevel 1 goto :unzipfail
del /f /q "%NATIVE%\steamcmd.zip"
if not exist "%NATIVE%\steamcmd\steamcmd.exe" goto :unzipfail
echo       已下載
goto :server
:hassteamcmd
echo       已存在,略過

rem ---------- 2. 遊戲伺服器 ----------
:server
echo [2/7] Palworld 專用伺服器(第一次約需下載數 GB,請耐心等)...
"%NATIVE%\steamcmd\steamcmd.exe" +force_install_dir "%SRVDIR%" +login anonymous +app_update 2394010 validate +quit
if errorlevel 1 goto :appfail
if not exist "%SRVDIR%\PalServer.exe" goto :appfail
echo       完成

rem ---------- 3. Python(存檔解析) ----------
echo [3/7] Python(解析存檔,查詢網站的玩家/帕魯資料靠它)...
call :ensure python "Python.Python.3.12" "%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
where python >nul 2>nul
if errorlevel 1 goto :needrerun

echo       安裝解析套件...
python -m pip install --quiet --disable-pip-version-check -r "%ROOT%\backend\tools\palsave\requirements.txt"
if errorlevel 1 goto :pipfail
echo       完成

rem ---------- 4. Node(建置查詢網站) ----------
echo [4/7] Node.js(建置查詢網站)...
call :ensure node "OpenJS.NodeJS.LTS" "%ProgramFiles%\nodejs"
where node >nul 2>nul
if errorlevel 1 goto :needrerun
call corepack enable >nul 2>nul
echo       完成

rem ---------- 5. Go(編譯排程器) ----------
echo [5/7] Go(編譯排程器)...
call :ensure go "GoLang.Go" "%ProgramFiles%\Go\bin"
where go >nul 2>nul
if errorlevel 1 goto :needrerun
echo       完成

rem ---------- 6. 建置網站 + 編譯排程器 ----------
echo [6/7] 建置查詢網站與排程器(第一次比較久)...
if exist "%ROOT%\frontend\packages\web\dist\index.html" goto :hasdist
pushd "%ROOT%\frontend"
call pnpm install --no-frozen-lockfile
if errorlevel 1 popd & goto :buildfail
call pnpm build
if errorlevel 1 popd & goto :buildfail
popd
:hasdist
if not exist "%ROOT%\frontend\packages\web\dist\index.html" goto :buildfail

pushd "%ROOT%\backend"
go build -o palscheduler.exe ./cmd/scheduler
if errorlevel 1 popd & goto :buildfail
popd
if not exist "%ROOT%\backend\palscheduler.exe" goto :buildfail
echo       完成

rem ---------- 7. 設定檔 ----------
echo [7/7] 設定檔(第一次會產生隨機密碼)...
if exist "%ROOT%\backend\config.json" goto :hasconfig
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\windows\setup.ps1"
if errorlevel 1 goto :setupfail
:hasconfig
if not exist "%ROOT%\backend\data" mkdir "%ROOT%\backend\data"
echo       完成

echo.
echo ============================================================
echo   全部裝好了!
echo   接著雙擊: windows\native\start-all.bat
echo   會一次帶起 遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站
echo   網站: http://localhost:9000    遊戲: 你的IP:8211
echo ============================================================
pause
exit /b 0

rem ---------- 共用:確認某個工具在不在,不在就用 winget 裝 ----------
rem   %1 = 指令名 (python/node/go)
rem   %2 = winget 套件 id
rem   %3 = 安裝後可能的路徑(分號分隔),用來當場補進 PATH,免得要重開視窗
:ensure
where %1 >nul 2>nul
if not errorlevel 1 exit /b 0
echo       找不到 %1,改用 winget 安裝...
where winget >nul 2>nul
if errorlevel 1 goto :nowinget
winget install -e --id %2 --accept-source-agreements --accept-package-agreements --silent
set "PATH=%PATH%;%~3"
where %1 >nul 2>nul
if not errorlevel 1 exit /b 0
echo       (%1 裝好了,但這個視窗還吃不到新的 PATH)
exit /b 1

:nowinget
echo.
echo [X] 這台電腦沒有 winget,無法自動安裝 %1。請手動安裝後重跑本檔:
echo       Python : https://www.python.org/downloads/  (勾選 Add python.exe to PATH)
echo       Node.js: https://nodejs.org/                (LTS 版)
echo       Go     : https://go.dev/dl/
pause
exit /b 1

:needrerun
echo.
echo 剛裝好的工具需要新的環境變數才找得到。
echo 請「關掉這個視窗」再雙擊一次 install.bat,就會從剛才的進度接著跑。
pause
exit /b 1

:dlfail
echo [X] SteamCMD 下載失敗,請檢查網路後重跑本檔。
pause
exit /b 1

:unzipfail
echo [X] SteamCMD 解壓縮失敗。刪掉 windows\native\steamcmd 與 steamcmd.zip 後重跑。
pause
exit /b 1

:appfail
echo [X] 伺服器安裝失敗(下載中斷或磁碟空間不足)。重跑本檔會從中斷處續傳。
pause
exit /b 1

:pipfail
echo [X] 解析套件安裝失敗。手動執行:
echo       python -m pip install -r backend\tools\palsave\requirements.txt
pause
exit /b 1

:buildfail
echo [X] 建置失敗,請截圖上方訊息求助。
pause
exit /b 1

:setupfail
echo [X] 設定檔產生失敗。手動執行:
echo       powershell -ExecutionPolicy Bypass -File windows\setup.ps1
pause
exit /b 1
