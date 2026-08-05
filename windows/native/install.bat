@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
set "ROOT=%CD%"
set "NATIVE=%ROOT%\windows\native"
call "%NATIVE%\ui.bat"
call "%NATIVE%\use-tools.bat"
rem Server install dir: windows\native\server by default; builds before
rem 1.0.2 used windows\server -- reuse it if found, to avoid re-downloading 6 GB.
set "SRVDIR=%NATIVE%\server"
if exist "%ROOT%\windows\server\PalServer.exe" set "SRVDIR=%ROOT%\windows\server"
title Palworld SteamCMD 版 - 一次裝好全部

rem Installs everything needed to run the full stack, in one go:
rem   SteamCMD -> game server -> Python (save parsing) -> Node (web build)
rem   -> Go (scheduler) -> build the site -> compile scheduler -> write config.
rem Missing Python/Node/Go are fetched as official portable builds
rem (see get-tools.bat), so a clean machine works in one click too.
rem Single-line commands + goto only: cmd mangles multi-line if(...) blocks

call "%NATIVE%\ui.bat" "Palworld SteamCMD 版:一次裝好" "不需要 Docker;乾淨電腦也行,缺的工具會自動下載可攜版"
if defined SKIP_STEAM goto :tools
echo.

rem ---------- 1. SteamCMD ----------
echo %T%[1/7]%R% SteamCMD...
if exist "%NATIVE%\steamcmd\steamcmd.exe" goto :hassteamcmd
if exist "%NATIVE%\steamcmd.zip" del /f /q "%NATIVE%\steamcmd.zip"
curl -L --fail -o "%NATIVE%\steamcmd.zip" "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
if errorlevel 1 goto :dlfail
if not exist "%NATIVE%\steamcmd" mkdir "%NATIVE%\steamcmd"
rem whenever the line endings are not CRLF. tar ships with Win10 1803+.
tar -xf "%NATIVE%\steamcmd.zip" -C "%NATIVE%\steamcmd"
if errorlevel 1 goto :unzipfail
del /f /q "%NATIVE%\steamcmd.zip"
if not exist "%NATIVE%\steamcmd\steamcmd.exe" goto :unzipfail
echo       %G%已下載%R%
goto :server
:hassteamcmd
echo       %G%已存在,略過%R%

rem ---------- 2. game server ----------
:server
echo %T%[2/7]%R% Palworld 專用伺服器(第一次約需下載數 GB,請耐心等)...
rem 'Missing configuration' has three known causes; try each in turn:
rem   1. SteamCMD just self-updated -> simply run it again
rem   2. stale appcache (most common after a self-update) -> delete and retry
rem   3. some builds need +login before +force_install_dir -> swap the order
rem Success is judged by PalServer.exe existing; steamcmd exit codes lie.
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
echo       %G%完成%R%

:tools
rem ---------- 3. Python (save parsing) ----------
echo %T%[3/7]%R% Python(解析存檔,查詢網站的玩家/帕魯資料靠它)...
call "%NATIVE%\get-tools.bat" python
if errorlevel 1 goto :toolfail

echo       安裝解析套件...
rem No --quiet on purpose: hiding pip's output leaves users with a bare
rem 'install failed' and nothing to act on.
call :pipinstall
if not errorlevel 1 goto :pipok
echo       %Y%系統的 Python 裝不起來,改用專案內建的 Python 再試一次...%R%
call "%NATIVE%\get-tools.bat" python force
if errorlevel 1 goto :pipfail
call :pipinstall
if errorlevel 1 goto :pipfail
:pipok
echo       %G%完成%R%

rem ---------- 4. Node (builds the web panel) ----------
echo %T%[4/7]%R% Node.js(建置查詢網站)...
call "%NATIVE%\get-tools.bat" node
if errorlevel 1 goto :toolfail
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "COREPACK_ENABLE_STRICT=0"
rem This line is the important one: pnpm self-switches to the version pinned
rem in package.json and fails with 'Failed to switch pnpm to vX' when it
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
echo       %G%完成%R%

rem ---------- 5. Go (compiles the scheduler) ----------
echo %T%[5/7]%R% Go(編譯排程器)...
call "%NATIVE%\get-tools.bat" go
if errorlevel 1 goto :toolfail
echo       %G%完成%R%

rem ---------- 6. build the site + compile the scheduler ----------
echo %T%[6/7]%R% 建置查詢網站與排程器(第一次比較久)...
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
echo       %G%完成%R%

rem ---------- 7. config files ----------
echo %T%[7/7]%R% 設定檔(預設密碼:管理 654321、進服 123456)...
if exist "%ROOT%\backend\config.json" goto :hasconfig
call "%ROOT%\windows\setup.bat"
if errorlevel 1 goto :setupfail
:hasconfig
if not exist "%ROOT%\backend\data" mkdir "%ROOT%\backend\data"
echo       %G%完成%R%

echo.
echo ==================================================
echo   %G%全部裝好了!%R%
echo   接著雙擊 %K%start-all.bat%R% 啟動全部服務
echo   網站: %K%http://localhost:9000%R%
echo   遊戲: %K%你的IP:8211%R%
echo ==================================================
pause
exit /b 0

:toolfail
echo %X%[X]%R% 工具安裝失敗(原因見上方訊息)。處理後重跑本檔,已完成的部分會自動略過。
pause
exit /b 1

:dlfail
echo %X%[X]%R% SteamCMD 下載失敗,請檢查網路後重跑本檔。
pause
exit /b 1

:unzipfail
echo %X%[X]%R% SteamCMD 解壓縮失敗。刪掉 windows\native\steamcmd 與 steamcmd.zip 後重跑。
pause
exit /b 1

:appfail
echo %X%[X]%R% 伺服器安裝失敗。常見原因:
echo     - 磁碟空間不足(伺服器本體約 6 GB,請留 10 GB 以上)
echo     - 網路中斷 / Steam CDN 不穩 —— 重跑本檔會從中斷處續傳
echo     - Missing configuration:本檔已試過四種解法(重跑、清快取、換參數順序、
echo       改裝到預設位置再搬)。都失敗的話,多半是防毒/受控資料夾存取擋住寫入
echo     - 路徑問題:放在「下載」「OneDrive」等會被同步或保護的資料夾容易失敗,
echo       建議把整個專案搬到 C:\palserver 這種短路徑再重跑
pause
exit /b 1

:pipinstall
python -m pip install --disable-pip-version-check -r "%ROOT%\backend\tools\palsave\requirements.txt"
exit /b %errorlevel%

:pipfail
echo %X%[X]%R% 解析套件安裝失敗(真正的錯誤在上面幾行)。常見三個成因:
echo    1. 專案路徑太長 —— Windows 預設上限 260 字元,套件會裝不進去。
echo       解法:把整個資料夾搬到 C:\palserver 這種短路徑再重跑。
echo    2. 沒有網路或被防火牆/公司代理擋住 pypi.org。
echo    3. 系統的 Python 是 32 位元或 Microsoft Store 版,裝不了我們要的套件。
echo       解法:本檔已自動改用內建 Python 重試過;若仍失敗請手動執行
echo       windows\native\tools\python\python.exe -m pip install -r backend\tools\palsave\requirements.txt
pause
exit /b 1

:pnpmfail
echo %X%[X]%R% 裝不起 pnpm(建置查詢網站需要它)。手動執行後重跑本檔:
echo       npm install -g pnpm
pause
exit /b 1

:buildfail
echo %X%[X]%R% 建置失敗。若訊息是「Failed to switch pnpm to vX」,執行下面兩行再重跑本檔:
echo       npm install -g pnpm
echo       set COREPACK_ENABLE_STRICT=0
echo     其他錯誤請截圖上方訊息求助。
pause
exit /b 1

:setupfail
echo %X%[X]%R% 設定檔產生失敗。手動執行:
echo       windows\setup.bat
pause
exit /b 1
