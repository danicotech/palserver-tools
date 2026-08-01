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

echo ==================================================
echo   Palworld SteamCMD 版:一次裝好
echo   不需要 Docker,裝完就能開服 + 開網站
echo ==================================================
echo.

rem ---------- 1. SteamCMD ----------
echo [1/7] SteamCMD...
if exist "%NATIVE%\steamcmd\steamcmd.exe" goto :hassteamcmd
if exist "%NATIVE%\steamcmd.zip" del /f /q "%NATIVE%\steamcmd.zip"
curl -L --fail -o "%NATIVE%\steamcmd.zip" "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
if errorlevel 1 goto :dlfail
if not exist "%NATIVE%\steamcmd" mkdir "%NATIVE%\steamcmd"
rem tar 是 Windows 10 1803 之後內建的,不需要 PowerShell
tar -xf "%NATIVE%\steamcmd.zip" -C "%NATIVE%\steamcmd"
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
rem 「Missing configuration」有三個已知成因,這裡逐次換招試:
rem   1. SteamCMD 剛自我更新完 → 再跑一次
rem   2. appcache 過期(自我更新後最常見)→ 刪掉再跑
rem   3. 部分版本要 +login 在 +force_install_dir 之前 → 換參數順序
rem 一律以 PalServer.exe 是否存在判定成功,steamcmd 的 exit code 不可靠。
set "SCMD=%NATIVE%\steamcmd\steamcmd.exe"

echo       嘗試 1/4:標準安裝
"%SCMD%" +force_install_dir "%SRVDIR%" +login anonymous +app_update 2394010 validate +quit
if exist "%SRVDIR%\PalServer.exe" goto :appok

echo.
echo       嘗試 2/4:清掉 SteamCMD 快取後再試(自我更新後最常見的卡點)
if exist "%NATIVE%\steamcmd\appcache" rd /s /q "%NATIVE%\steamcmd\appcache"
timeout /t 2 /nobreak >nul
"%SCMD%" +force_install_dir "%SRVDIR%" +login anonymous +app_update 2394010 validate +quit
if exist "%SRVDIR%\PalServer.exe" goto :appok

echo.
echo       嘗試 3/4:改用 login 在前的參數順序
"%SCMD%" +login anonymous +force_install_dir "%SRVDIR%" +app_update 2394010 validate +quit
if exist "%SRVDIR%\PalServer.exe" goto :appok

echo.
echo       嘗試 4/4:先裝到 SteamCMD 預設位置,再搬到 server 資料夾
"%SCMD%" +login anonymous +app_update 2394010 validate +quit
if not exist "%NATIVE%\steamcmd\steamapps\common\PalServer\PalServer.exe" goto :appfail
echo       搬移中...
robocopy "%NATIVE%\steamcmd\steamapps\common\PalServer" "%SRVDIR%" /E /MOVE /NFL /NDL /NJH /NJS >nul
if not exist "%SRVDIR%\PalServer.exe" goto :appfail

:appok
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
rem corepack 會照 package.json 的 packageManager 去抓指定版本的 pnpm,
rem 抓失敗就會出現「Failed to switch pnpm to vX」。關掉互動提示與嚴格檢查,
rem 真的抓不到就退回全域安裝的 pnpm(版本不同也能建置)。
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "COREPACK_ENABLE_STRICT=0"
rem 這一行才是關鍵:pnpm 會照 package.json 的 packageManager 自我切換版本,
rem 下載不到就報「Failed to switch pnpm to vX」。關掉它,用現有的 pnpm 建置即可。
set "npm_config_manage_package_manager_versions=false"
call corepack enable >nul 2>nul
pushd "%ROOT%\frontend"
call corepack prepare --activate >nul 2>nul
popd
call pnpm --version >nul 2>nul
if not errorlevel 1 goto :haspnpm
echo       corepack 取不到指定版本的 pnpm,改用 npm 全域安裝...
call npm install -g pnpm >nul 2>nul
call pnpm --version >nul 2>nul
if errorlevel 1 goto :pnpmfail
:haspnpm
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
echo [7/7] 設定檔(預設密碼:管理 654321、進服 123456)...
if exist "%ROOT%\backend\config.json" goto :hasconfig
call "%ROOT%\windows\setup.bat"
if errorlevel 1 goto :setupfail
:hasconfig
if not exist "%ROOT%\backend\data" mkdir "%ROOT%\backend\data"
echo       完成

echo.
echo ==================================================
echo   全部裝好了!
echo   接著雙擊 start-all.bat 啟動全部服務
echo   網站: http://localhost:9000
echo   遊戲: 你的IP:8211
echo ==================================================
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
echo [X] 伺服器安裝失敗。常見原因:
echo     - 磁碟空間不足(伺服器本體約 6 GB,請留 10 GB 以上)
echo     - 網路中斷 / Steam CDN 不穩 —— 重跑本檔會從中斷處續傳
echo     - Missing configuration:本檔已試過四種解法(重跑、清快取、換參數順序、
echo       改裝到預設位置再搬)。都失敗的話,多半是防毒/受控資料夾存取擋住寫入
echo     - 路徑問題:放在「下載」「OneDrive」等會被同步或保護的資料夾容易失敗,
echo       建議把整個專案搬到 C:\palserver 這種短路徑再重跑
pause
exit /b 1

:pipfail
echo [X] 解析套件安裝失敗。手動執行:
echo       python -m pip install -r backend\tools\palsave\requirements.txt
pause
exit /b 1

:pnpmfail
echo [X] 裝不起 pnpm(建置查詢網站需要它)。手動執行後重跑本檔:
echo       npm install -g pnpm
pause
exit /b 1

:buildfail
echo [X] 建置失敗。若訊息是「Failed to switch pnpm to vX」,執行下面兩行再重跑本檔:
echo       npm install -g pnpm
echo       set COREPACK_ENABLE_STRICT=0
echo     其他錯誤請截圖上方訊息求助。
pause
exit /b 1

:setupfail
echo [X] 設定檔產生失敗。手動執行:
echo       windows\setup.bat
pause
exit /b 1
