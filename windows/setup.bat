@echo off
rem First-run setup (pure batch, no PowerShell needed):
rem   creates .env and backend\config.json when missing, with default
rem   passwords + a random API token, keeping config.json rcon.password in
rem   sync with ADMIN_PASSWORD in .env. Existing files are never touched,
rem
rem   so re-running is safe. Encoding is always UTF-8 without BOM:
rem   a BOM in .env makes docker compose miss the first variable.
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "ROOT=%CD%"

rem ---------- passwords and API token ----------
rem Both passwords use memorable defaults (fine for LAN/self-hosting; change
rem them in .env before exposing to the internet). The API token is only used
set "CHARS=abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
set "ADMINPW=654321"
set "JOINPW=123456"
call :rand 32 APITOKEN

rem ---------- .env ----------
if exist "%ROOT%\.env" goto :hasenv
if not exist "%ROOT%\.example.env" goto :noexample
rem by the panel to call the scheduler, so it stays random.
rem Note: the search string must not contain '=' -- batch !VAR:find=repl!
call :render "%ROOT%\.example.env" "%ROOT%\.env" "CHANGE_ME_ADMIN" "!ADMINPW!" "CHANGE_ME_JOIN" "!JOINPW!"
echo 已從 .example.env 產生 .env(使用預設密碼;所有伺服器參數都可在 .env 調整)
goto :envdone
:hasenv
rem splits on the first '=', so match the placeholder alone (CHANGE_ME_ADMIN).
for /f "usebackq tokens=1,* delims==" %%a in ("%ROOT%\.env") do (
  if /i "%%a"=="ADMIN_PASSWORD" set "ADMINPW=%%b"
  if /i "%%a"=="SERVER_PASSWORD" set "JOINPW=%%b"
)
:envdone

rem ---------- backend\config.json ----------
if exist "%ROOT%\backend\config.json" goto :hascfg
if not exist "%ROOT%\backend\config.example.json" goto :nocfgexample
call :render "%ROOT%\backend\config.example.json" "%ROOT%\backend\config.json" "CHANGE_ME_SAME_AS_ADMIN_PASSWORD" "!ADMINPW!" "CHANGE_THIS_TOKEN_TO_A_LONG_RANDOM_STRING" "!APITOKEN!"
echo 已產生 backend\config.json(密碼已與 .env 同步、API token 已隨機生成)
goto :cfgdone
:hascfg
echo backend\config.json 已存在,保持不動
:cfgdone

echo.
echo ================ 你的伺服器密碼 ================
echo   管理密碼 ADMIN_PASSWORD : !ADMINPW!
echo   進服密碼 SERVER_PASSWORD: !JOINPW!
echo   (以上為預設值。要開放給外網玩,請編輯專案根目錄的 .env
echo    換成不好猜的密碼,再雙擊 restart.bat 套用)
echo =============================================================
exit /b 0

:noexample
echo [X] 找不到 .example.env,無法產生 .env
exit /b 1

:nocfgexample
echo [X] 找不到 backend\config.example.json,無法產生 config.json
exit /b 1

rem ---------- sub: random string ----------
rem   %1 = length, %2 = variable name to write back
:rand
setlocal enabledelayedexpansion
set "OUT="
set /a N=%~1
for /l %%i in (1,1,%N%) do (
  set /a IDX=!random! %% 55
  for %%j in (!IDX!) do set "OUT=!OUT!!CHARS:~%%j,1!"
)
endlocal & set "%~2=%OUT%"
exit /b 0

rem ---------- sub: render a template ----------
rem   %1 src, %2 dst, %3/%4 first replacement, %5/%6 second replacement
rem   findstr /n prefixes each line with 'N:' so blank lines survive for /f;
rem   the prefix is stripped after reading.
:render
setlocal enabledelayedexpansion
set "SRC=%~1"
set "DST=%~2"
> "%DST%" (
  for /f "usebackq delims=" %%L in (`findstr /n "^" "%SRC%"`) do (
    set "LN=%%L"
    set "LN=!LN:*:=!"
    rem On blank lines LN is undefined and replacement would emit literals; guard it.
    if defined LN if not "%~3"=="" set "LN=!LN:%~3=%~4!"
    if defined LN if not "%~5"=="" set "LN=!LN:%~5=%~6!"
    echo(!LN!
  )
)
endlocal
exit /b 0
