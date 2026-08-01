@echo off
rem 首次啟動自動設定(Windows,純 batch —— 不需要 PowerShell):
rem   沒有 .env / backend\config.json 時自動產生 —— 隨機密碼 + token,
rem   並讓 config.json 的 rcon.password 與 .env 的 ADMIN_PASSWORD 保持一致。
rem 已存在的檔案一律不動,重複執行安全。
rem
rem 編碼:一律 chcp 65001,範本與輸出都是 UTF-8(無 BOM)。
rem   .env 若帶 BOM,docker compose 會讀不到第一個變數,所以絕對不能加 BOM。
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "ROOT=%CD%"

rem ---------- 產生兩組隨機密碼與 API token ----------
rem 用 %RANDOM% 逐字元從字元表取字(去掉容易看錯的 0/O/1/l/I)。
set "CHARS=abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
call :rand 14 ADMINPW
call :rand 8  JOINPW
call :rand 32 APITOKEN

rem ---------- .env ----------
if exist "%ROOT%\.env" goto :hasenv
if not exist "%ROOT%\.example.env" goto :noexample
rem 注意:搜尋字串不能含「=」—— batch 的 !VAR:搜尋=取代! 會從第一個 = 拆開,
rem 所以這裡只比對佔位符本身(CHANGE_ME_ADMIN),不要連 KEY= 一起寫進去。
call :render "%ROOT%\.example.env" "%ROOT%\.env" "CHANGE_ME_ADMIN" "!ADMINPW!" "CHANGE_ME_JOIN" "!JOINPW!"
echo 已從 .example.env 產生 .env(兩組密碼已隨機生成;所有伺服器參數都可在 .env 調整)
goto :envdone
:hasenv
rem 已有 .env → 沿用裡面的 ADMIN_PASSWORD,讓 config.json 的 rcon 密碼跟它一致
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
echo ================ 你的伺服器密碼(保存好!) ================
echo   管理密碼 ADMIN_PASSWORD : !ADMINPW!
echo   進服密碼 SERVER_PASSWORD: !JOINPW!
echo   (之後想改:編輯專案根目錄的 .env,再雙擊 restart.bat)
echo =============================================================
exit /b 0

:noexample
echo [X] 找不到 .example.env,無法產生 .env
exit /b 1

:nocfgexample
echo [X] 找不到 backend\config.example.json,無法產生 config.json
exit /b 1

rem ---------- 子程序:產生隨機字串 ----------
rem   %1 = 長度  %2 = 要寫回的變數名
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

rem ---------- 子程序:套範本 ----------
rem   %1 來源  %2 輸出  %3/%4 第一組取代  %5/%6 第二組取代
rem   findstr /n 會在每行前加「行號:」,這樣空行才不會被 for /f 吃掉,
rem   讀進來後再把行號前綴切掉。
:render
setlocal enabledelayedexpansion
set "SRC=%~1"
set "DST=%~2"
> "%DST%" (
  for /f "usebackq delims=" %%L in (`findstr /n "^" "%SRC%"`) do (
    set "LN=%%L"
    set "LN=!LN:*:=!"
    rem 空行時 LN 會變成未定義,此時再做取代會留下字面值 —— 用 if defined 擋掉
    if defined LN if not "%~3"=="" set "LN=!LN:%~3=%~4!"
    if defined LN if not "%~5"=="" set "LN=!LN:%~5=%~6!"
    echo(!LN!
  )
)
endlocal
exit /b 0
