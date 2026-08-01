@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
title 檢查/清除本機資料(要把資料夾給別人前用這支)

rem 網站是靜態的,上面看到的玩家數只可能來自「這台機器上真的存在的存檔」。
rem 這支先列出所有會外流的資料,確認後才刪 —— 不會碰任何程式碼與設定範本。

echo ==================================================
echo   檢查這個資料夾裡有沒有「你的資料」
echo   %ROOT%
echo ==================================================
echo.

set "FOUND=0"
call :check "backend\palworld-data"        "Docker 版的世界存檔(玩家、帕魯、據點)"
call :check "windows\native\server\Pal"    "SteamCMD 版(Windows)的世界存檔"
call :check "linux\native\server\Pal"      "SteamCMD 版(Linux)的世界存檔"
call :check "backend\data"                 "頭像名冊 roster.json、上線統計 presence.json"
call :checkfile ".env"                     "伺服器參數與兩組密碼"
call :checkfile "backend\config.json"      "RCON 密碼與 API token"
call :check "windows\native\steamcmd\logs" "SteamCMD 日誌(含你的電腦路徑)"

echo.
if "%FOUND%"=="0" goto :clean

echo --------------------------------------------------
echo 以上就是「把資料夾直接壓縮給別人」會外流的東西。
echo.
echo   刪掉後對方拿到的會是全新環境;你自己這台若還要繼續用,
echo   請不要在「你正在用的那份」執行刪除 —— 先複製一份再清。
echo.
choice /c YN /n /m "確定要在這個資料夾刪除上面列出的資料嗎?(Y=刪 / N=取消) "
if errorlevel 2 goto :cancel

echo.
if exist "%ROOT%\backend\palworld-data"        rd /s /q "%ROOT%\backend\palworld-data"
if exist "%ROOT%\windows\native\server\Pal"    rd /s /q "%ROOT%\windows\native\server\Pal"
if exist "%ROOT%\linux\native\server\Pal"      rd /s /q "%ROOT%\linux\native\server\Pal"
if exist "%ROOT%\backend\data"                 rd /s /q "%ROOT%\backend\data"
if exist "%ROOT%\windows\native\steamcmd\logs" rd /s /q "%ROOT%\windows\native\steamcmd\logs"
if exist "%ROOT%\.env"                         del /f /q "%ROOT%\.env"
if exist "%ROOT%\backend\config.json"          del /f /q "%ROOT%\backend\config.json"
echo 已清除。下次啟動會重新產生設定與全新世界。
echo.
echo 提示:更保險的做法是用 tools\pack-release.bat 直接導出乾淨壓縮檔,
echo       那支只讀不刪,完全不會動到你現在的環境。
pause
exit /b 0

:clean
echo 這個資料夾裡沒有任何存檔或密碼,可以直接給別人。
pause
exit /b 0

:cancel
echo 已取消,什麼都沒刪。
pause
exit /b 0

rem ---- 子程序:資料夾 ----
:check
if not exist "%ROOT%\%~1" exit /b 0
set "FOUND=1"
echo   [有] %~1
echo        %~2
exit /b 0

rem ---- 子程序:單一檔案 ----
:checkfile
if not exist "%ROOT%\%~1" exit /b 0
set "FOUND=1"
echo   [有] %~1
echo        %~2
exit /b 0
