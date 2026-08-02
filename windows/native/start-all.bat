@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
title 帕魯全套服務(SteamCMD 版,不用 Docker)

rem 一次帶起「遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站」,完全不需要 Docker。
rem   palsave    : Python 解析存檔(玩家/帕魯/公會資料的唯一來源)
rem   scheduler  : Go 排程器,同時提供 http://localhost:9000 的查詢網站與 API
rem   PalServer  : 由排程器依 backend\config.json 的時段表自動開關
rem 一律單行 + goto,避免多行 if(...) 區塊在非 CRLF 換行時被 cmd 拆爛。

set "SERVER_DIR=%CD%\windows\native\server"
rem 舊版(1.0.2 以前)裝在 windows\server,兩個位置都認
if not exist "%SERVER_DIR%\PalServer.exe" if exist "%CD%\windows\server\PalServer.exe" set "SERVER_DIR=%CD%\windows\server"
set "PANEL_DIR=%CD%\frontend\packages\web\dist"
set "CONFIG_PATH=%CD%\backend\config.json"
set "SAVE_ROOT=%SERVER_DIR%"
set "PRESENCE_PATH=%CD%\backend\data\presence.json"
set "ROSTER_PATH=%CD%\backend\data\roster.json"
set "PALS_CACHE_PATH=%CD%\backend\data\pals-cache.json"
rem Docker 版的預設位址是 compose 內網名稱,本機直跑要指回 127.0.0.1
set "PALSAVE_URL=http://127.0.0.1:8213"
set "REST_HOST=127.0.0.1"
set "RCON_HOST=127.0.0.1"

echo [1/5] 檢查伺服器本體...
if not exist "%SERVER_DIR%\PalServer.exe" goto :noserver

echo [2/5] 檢查 Python(存檔解析用)...
where python >nul 2>nul
if errorlevel 1 goto :nopython
python -c "import pyooz, palworld_save_tools" >nul 2>nul
if not errorlevel 1 goto :haspy
echo     安裝解析套件(只有第一次需要)...
python -m pip install --quiet --disable-pip-version-check -r "backend\tools\palsave\requirements.txt"
if errorlevel 1 goto :pipfail
:haspy

echo [3/5] 檢查查詢網站(dist)...
if exist "%PANEL_DIR%\index.html" goto :hasdist
where pnpm >nul 2>nul
if errorlevel 1 goto :nodist
echo     第一次要先建置網站(需要幾分鐘)...
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "COREPACK_ENABLE_STRICT=0"
rem 這一行才是關鍵:pnpm 會照 package.json 的 packageManager 自我切換版本,
rem 下載不到就報「Failed to switch pnpm to vX」。關掉它,用現有的 pnpm 建置即可。
set "npm_config_manage_package_manager_versions=false"
pushd frontend
call pnpm install --no-frozen-lockfile
call pnpm build
popd
if not exist "%PANEL_DIR%\index.html" goto :nodist
:hasdist

echo [4/5] 檢查排程器執行檔...
if exist "backend\palscheduler.exe" goto :hasbin
where go >nul 2>nul
if errorlevel 1 goto :nogo
echo     編譯排程器(只有第一次需要)...
pushd backend
go build -o palscheduler.exe ./cmd/scheduler
popd
if not exist "backend\palscheduler.exe" goto :gofail
:hasbin

rem 沒有設定檔就自己產生(不要叫使用者去手動跑指令)
if exist "backend\config.json" goto :hascfg
echo     第一次啟動,產生設定檔(預設密碼:管理 654321、進服 123456)...
call "%CD%\windows\setup.bat"
if not exist "backend\config.json" goto :noconfig
:hascfg
if not exist "backend\data" mkdir "backend\data"
if not exist "backend\data\logs" mkdir "backend\data\logs"

rem 官方 DefaultPalWorldSettings.ini 預設 RESTAPIEnabled=False、RCONEnabled=False,
rem 照抄過去的話排程器完全沒辦法跟伺服器講話(廣播/踢人/關機/在線人數全部失敗)。
rem 這裡在啟動前補開,順便把空的密碼填上 —— 使用者自己改過的值不會被動到。
set "ADMINPW="
set "JOINPW="
if not exist ".env" goto :nodotenv
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="ADMIN_PASSWORD" set "ADMINPW=%%b"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="SERVER_PASSWORD" set "JOINPW=%%b"
:nodotenv
python "backend\tools\ensure_server_ini.py" "%SERVER_DIR%" "%ADMINPW%" "%JOINPW%"

echo [5/5] 啟動存檔解析與排程器...
rem 這兩個視窗是常駐服務,不是殘留的東西 —— 關掉就等於把服務關掉,
rem 所以標題直接寫清楚,免得使用者以為可以隨手關。
rem (要真正無視窗需要用 CREATE_NO_WINDOW 起子行程,那是 GUI exe 版的事。)
start "存檔解析 palsave:8213(關掉=網站查不到玩家)" /min cmd /c "cd /d "%CD%\backend\tools\palsave" && set SAVE_ROOT=%SAVE_ROOT%&& set PORT=8213&& python server.py"
timeout /t 2 /nobreak >nul
start "排程器 palscheduler:9000(關掉=網站與自動開關停擺)" /min cmd /c "cd /d "%CD%\backend" && palscheduler.exe serve"
timeout /t 3 /nobreak >nul

rem 確認真的起來了 —— 埠被佔用(例如 Docker 版正在跑)時 palscheduler 會直接結束,
rem 這時候還印「完成」只會讓人以為好了。
set /a _hc=0
:health
curl -s -o nul -m 2 http://127.0.0.1:9000/healthz
if not errorlevel 1 goto :healthy
set /a _hc+=1
if %_hc% GEQ 10 goto :notup
timeout /t 2 /nobreak >nul
goto :health

:healthy
echo.
echo 完成!(遊戲伺服器由排程器依時段表自動開關)
rem 埠與密碼都在 PalWorldSettings.ini 裡,直接讀出來給使用者看,不用自己去翻
call "%~dp0show-info.bat" "%SERVER_DIR%" 9000
echo 要全部關掉:雙擊 windows\native\stop-all.bat
start http://localhost:9000
pause
exit /b 0

:notup
echo.
echo [X] 服務沒有起來(http://localhost:9000 沒有回應)。最常見的原因:
echo     1. Docker 版正在跑,佔住了同一個埠 —— 先跑 windows\stop.bat 把 Docker 版停掉
echo     2. 排程器啟動失敗 —— 打開剛才那個 palscheduler 視窗看錯誤訊息
echo     3. 防火牆擋住本機連線
pause
exit /b 1

:noserver
echo [X] 找不到伺服器本體(PalServer.exe)。已檢查這兩個位置:
echo       %CD%\windows\native\server\
echo       %CD%\windows\server\          (1.0.2 以前的舊位置)
if exist "%CD%\windows\native\steamcmd\steamcmd.exe" echo.
if exist "%CD%\windows\native\steamcmd\steamcmd.exe" echo     SteamCMD 有、伺服器沒有 = 安裝中途被關掉了(伺服器本體約 6 GB)。
echo.
echo     請雙擊 windows\native\install.bat —— 它會從中斷處續傳,不會重下已完成的部分。
pause
exit /b 1

:nopython
echo [X] 找不到 Python。查詢網站的玩家/帕魯資料需要它來解析存檔。
echo     安裝(勾選 Add python.exe to PATH):https://www.python.org/downloads/
echo     或用 winget:winget install -e --id Python.Python.3.12
pause
exit /b 1

:pipfail
echo [X] 解析套件安裝失敗。手動執行:
echo     python -m pip install -r backend\tools\palsave\requirements.txt
pause
exit /b 1

:nodist
echo [X] 查詢網站尚未建置,而且找不到 pnpm 無法自動建。
echo     裝好 Node.js(https://nodejs.org/)後執行:
echo       corepack enable
echo       cd frontend ^&^& pnpm install ^&^& pnpm build
pause
exit /b 1

:nogo
echo [X] 找不到排程器執行檔,也沒有 Go 可以編譯。
echo     裝 Go(https://go.dev/dl/)後重跑本檔,或改用 Docker 版。
pause
exit /b 1

:gofail
echo [X] 排程器編譯失敗,請截圖上方訊息求助。
pause
exit /b 1

:noconfig
echo [X] 產生 backend\config.json 失敗。手動執行 windows\setup.bat 後再試。
pause
exit /b 1
