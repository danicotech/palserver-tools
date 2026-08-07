@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
title 帕魯全套服務(SteamCMD 版,不用 Docker)
call "%~dp0ui.bat" "帕魯全套服務 · SteamCMD 版" "遊戲伺服器 + 排程開關服 + 存檔解析 + 查詢網站"
call "%~dp0use-tools.bat"

rem Brings up game server + scheduler + save parser + web panel. No Docker.
rem   palsave   : Python save parser (sole source of player/pal/guild data)
rem   scheduler : Go service; also serves the site + API on localhost:9000
rem   PalServer : started/stopped by the scheduler per backend\config.json
rem Single-line + goto only: cmd mangles multi-line if(...) without CRLF.

rem Which server folder to use. Asks on the first run, then remembers - so an
rem existing SteamCMD install anywhere on the machine can be used as-is, with no
rem files copied or moved. Type C at its prompt to switch folders later.
call "%~dp0pick-server-dir.bat"
set "SERVER_DIR="
if exist "%CD%\backend\data\server-dir.txt" for /f "usebackq delims=" %%a in ("%CD%\backend\data\server-dir.txt") do set "SERVER_DIR=%%~a"
if not defined SERVER_DIR goto :nopick
set "PANEL_DIR=%CD%\frontend\packages\web\dist"
set "CONFIG_PATH=%CD%\backend\config.json"
rem One folder answers both questions: a SteamCMD install keeps PalServer.exe and
rem Pal\Saved next to each other, so the server we control is also the server
rem whose saves the panel reads.
set "SAVE_ROOT=%SERVER_DIR%"
set "PRESENCE_PATH=%CD%\backend\data\presence.json"
set "ROSTER_PATH=%CD%\backend\data\roster.json"
set "PALS_CACHE_PATH=%CD%\backend\data\pals-cache.json"
rem Docker defaults point at compose service names; running bare needs 127.0.0.1.
set "PALSAVE_URL=http://127.0.0.1:8213"
set "REST_HOST=127.0.0.1"
set "RCON_HOST=127.0.0.1"

echo %T%[1/5]%R% 檢查伺服器本體...
echo     使用的伺服器資料夾:"%SERVER_DIR%"
if not exist "%SERVER_DIR%\PalServer.exe" goto :noserver

echo %T%[2/5]%R% 檢查 Python(存檔解析用)...
where python >nul 2>nul
if errorlevel 1 goto :nopython
python -c "import ooz, palworld_save_tools" >nul 2>nul
if not errorlevel 1 goto :haspy
echo     安裝解析套件(只有第一次需要)...
python -m pip install --disable-pip-version-check -r "backend\tools\palsave\requirements.txt"
if errorlevel 1 goto :pipfail
:haspy

echo %T%[3/5]%R% 檢查查詢網站(dist)...
if exist "%PANEL_DIR%\index.html" goto :hasdist
where pnpm >nul 2>nul
if errorlevel 1 goto :nodist
echo     第一次要先建置網站(需要幾分鐘)...
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "COREPACK_ENABLE_STRICT=0"
rem This line is the important one: pnpm self-switches to the pinned version
rem and dies with 'Failed to switch pnpm to vX' if it cannot download it.
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

rem Generate the config ourselves; never ask the user to run a command.
if exist "backend\config.json" goto :hascfg
echo     第一次啟動,產生設定檔(預設密碼:管理 654321、進服 123456)...
call "%CD%\windows\setup.bat"
if not exist "backend\config.json" goto :noconfig
:hascfg
if not exist "backend\data" mkdir "backend\data"
if not exist "backend\data\logs" mkdir "backend\data\logs"

rem Official DefaultPalWorldSettings.ini ships with RESTAPIEnabled=False and
rem RCONEnabled=False; copying that verbatim leaves the scheduler unable to
rem talk to the server at all (broadcast/kick/shutdown/online count all fail).
set "ADMINPW="
set "JOINPW="
if not exist ".env" goto :nodotenv
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="ADMIN_PASSWORD" set "ADMINPW=%%b"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="SERVER_PASSWORD" set "JOINPW=%%b"
:nodotenv
rem --config makes the panel's config.json the single source of truth for the
rem admin password. It used to come from .env while the panel connected with
rem config.json's rcon.password; whenever those two drifted apart every REST
rem and RCON call came back 401 and the server only said "AdminPassword is
rem empty", which points at neither file.
python "backend\tools\ensure_server_ini.py" "%SERVER_DIR%" "%ADMINPW%" "%JOINPW%" --config "%CONFIG_PATH%"

rem A save copied in from another machine is not loaded just because it is
rem there: the server only reads the world named in GameUserSettings.ini and
rem silently starts a brand new one when the name does not match. The panel
rem scans every world folder, so it shows the copied save while the game runs
rem an empty world - which looks like the panel is lying. Line them up first.
python "backend\tools\ensure_world.py" "%SERVER_DIR%"

echo %T%[5/5]%R% 啟動服務...
rem Check port 9000 first: if it is taken the scheduler exits immediately and
rem the user only sees an error flash by. Better to say it up front.
curl -s -o nul -m 2 http://127.0.0.1:9000/healthz
if not errorlevel 1 goto :occupied

rem palsave runs as a child of the scheduler using CREATE_NO_WINDOW, so no
rem extra console pops up; its output lands here and in logs\palsave.log.
rem The scheduler runs in THIS window too: one window for the whole stack.
set "PALSAVE_SPAWN=1"
set "PALSAVE_DIR=%CD%\backend\tools\palsave"
set "PALSAVE_PORT=8213"
set "PALSAVE_LOG=%CD%\backend\data\logs\palsave.log"
rem The scheduler opens the browser once it is really listening; no blind sleep.
set "PANEL_URL=http://localhost:9000"
set "PANEL_OPEN_BROWSER=1"

rem Ports and passwords live in PalWorldSettings.ini; show them so nobody digs.
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

:nopick
echo %X%[X]%R% 沒有選好伺服器資料夾,不啟動。
echo     重跑一次 windows\native\start-all.bat,在第一個問題輸入編號,
echo     或直接貼上資料夾路徑(例如 D:\steamcmd\steamapps\common\PalServer)。
pause
exit /b 1

:noserver
echo %X%[X]%R% 這個資料夾裡沒有 PalServer.exe:
echo       "%SERVER_DIR%"
echo     它記在 backend\data\server-dir.txt。重跑 start-all,在第一個問題輸入 C
echo     就可以改指到別的資料夾;或直接刪掉那個檔案讓它重新問。
echo.
echo     還沒裝過伺服器的話,雙擊 windows\native\install.bat 會裝到:
echo       %CD%\windows\native\server\
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
