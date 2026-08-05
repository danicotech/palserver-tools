@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
title 帕魯全套服務(SteamCMD 版,不用 Docker)
call "%~dp0ui.bat" "帕魯全套服務 · SteamCMD 版" "遊戲伺服器 + 排程開關服 + 存檔解析 + 查詢網站"
call "%~dp0use-tools.bat"

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

echo %T%[1/5]%R% 檢查伺服器本體...
if not exist "%SERVER_DIR%\PalServer.exe" goto :noserver

echo %T%[2/5]%R% 檢查 Python(存檔解析用)...
where python >nul 2>nul
if errorlevel 1 goto :nopython
python -c "import ooz, palworld_save_tools" >nul 2>nul
if not errorlevel 1 goto :haspy
echo     安裝解析套件(只有第一次需要)...
python -m pip install --quiet --disable-pip-version-check -r "backend\tools\palsave\requirements.txt"
if errorlevel 1 goto :pipfail
:haspy

echo %T%[3/5]%R% 檢查查詢網站(dist)...
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

echo %T%[4/5]%R% 檢查排程器執行檔...
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

echo %T%[5/5]%R% 啟動服務...
rem 先確認 9000 沒被佔住 —— 被佔住時排程器會立刻結束,
rem 直接跑下去只會看到一閃而過的錯誤,不如先講清楚。
curl -s -o nul -m 2 http://127.0.0.1:9000/healthz
if not errorlevel 1 goto :occupied

rem 存檔解析(palsave)改由排程器當子行程帶起來 —— Windows 用 CREATE_NO_WINDOW,
rem 不會再彈一個黑視窗;它的訊息會直接印在下面這個視窗裡,並落地到 logs\palsave.log。
rem 排程器本身也跑在「這個」視窗,不再另開 —— 從此全套服務只有一個視窗。
set "PALSAVE_SPAWN=1"
set "PALSAVE_DIR=%CD%\backend\tools\palsave"
set "PALSAVE_PORT=8213"
set "PALSAVE_LOG=%CD%\backend\data\logs\palsave.log"
rem 瀏覽器由排程器在「真的聽好了」之後自己開,腳本這邊不用瞎等幾秒
set "PANEL_URL=http://localhost:9000"
set "PANEL_OPEN_BROWSER=1"

rem 埠與密碼都在 PalWorldSettings.ini 裡,直接讀出來給使用者看,不用自己去翻
call "%~dp0show-info.bat" "%SERVER_DIR%" 9000
title 帕魯服務執行中(關掉這個視窗＝停止服務)
echo 這個視窗就是服務本身,下面是即時訊息(存檔解析與排程器都在裡面)。
echo 停止服務:按 Ctrl+C,或雙擊 windows\native\stop-all.bat
echo ==================================================
pushd backend
palscheduler.exe serve
popd
echo.
echo 服務已停止。
pause
exit /b 0

:occupied
echo.
echo %X%[X]%R% 127.0.0.1:9000 已經有服務在跑了,不重複啟動。可能是:
echo     1. Docker 版正在跑,佔住同一個埠 —— 先跑 windows\stop.bat 把它停掉
echo     2. 之前開的 start-all 還在 —— 找找工作列上有沒有另一個「帕魯服務執行中」視窗
pause
exit /b 1

:noserver
echo %X%[X]%R% 找不到伺服器本體(PalServer.exe)。已檢查這兩個位置:
echo       %CD%\windows\native\server\
echo       %CD%\windows\server\          (1.0.2 以前的舊位置)
if exist "%CD%\windows\native\steamcmd\steamcmd.exe" echo.
if exist "%CD%\windows\native\steamcmd\steamcmd.exe" echo     SteamCMD 有、伺服器沒有 = 安裝中途被關掉了(伺服器本體約 6 GB)。
echo.
echo     請雙擊 windows\native\install.bat —— 它會從中斷處續傳,不會重下已完成的部分。
pause
exit /b 1

:nopython
echo %X%[X]%R% 找不到 Python。查詢網站的玩家/帕魯資料需要它來解析存檔。
echo     雙擊 windows\native\install.bat 就會自動下載可攜版(不動系統、免管理員權限),
echo     裝好的部分會自動略過,不會重下 6 GB 的伺服器。
pause
exit /b 1

:pipfail
echo %X%[X]%R% 解析套件安裝失敗。手動執行:
echo     python -m pip install -r backend\tools\palsave\requirements.txt
pause
exit /b 1

:nodist
echo %X%[X]%R% 查詢網站尚未建置,而且找不到 pnpm 無法自動建。
echo     雙擊 windows\native\install.bat 就會自動下載 Node 可攜版並建置網站。
pause
exit /b 1

:nogo
echo %X%[X]%R% 找不到排程器執行檔,也沒有 Go 可以編譯。
echo     雙擊 windows\native\install.bat 就會自動下載 Go 可攜版並編譯。
pause
exit /b 1

:gofail
echo %X%[X]%R% 排程器編譯失敗,請截圖上方訊息求助。
pause
exit /b 1

:noconfig
echo %X%[X]%R% 產生 backend\config.json 失敗。手動執行 windows\setup.bat 後再試。
pause
exit /b 1
