@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
title 打包乾淨版本(要給別人時用這個)

rem 直接壓縮整個資料夾會把「被 git 忽略的檔案」一起帶走 ——
rem   .env(密碼)、backend\config.json(密碼/token)、backend\data(頭像名冊、上線統計)
rem   backend\palworld-data、windows\native\server(存檔、玩家、據點)
rem 這支改用 git archive:只導出「版控裡的檔案」,以上通通不會進去,
rem 而且完全不動你現在的環境(只是讀取,不刪任何東西)。

where git >nul 2>nul
if errorlevel 1 goto :nogit

for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%i"
set "OUT=%USERPROFILE%\Desktop\palserver-tools-%STAMP%.zip"

echo 正在打包(只含版控中的檔案,不含任何存檔/密碼)...
git archive --format=zip -o "%OUT%" HEAD
if errorlevel 1 goto :fail

echo.
echo ==================================================
echo   打包完成
echo   %OUT%
echo.
echo   內容:程式碼與腳本
echo   不含:.env、config.json、backend\data、
echo         palworld-data、native\server(存檔與玩家資料)
echo.
echo   對方拿到後:解壓縮 → 雙擊 windows\start.bat
echo   或不用 Docker:windows\native\install.bat → start-all.bat
echo ==================================================
pause
exit /b 0

:nogit
echo [X] 找不到 git,無法乾淨打包。
echo     手動做法:複製整個資料夾後,把下面這些「刪掉再壓縮」:
echo       .env
echo       backend\config.json
echo       backend\data\
echo       backend\palworld-data\
echo       windows\native\server\   linux\native\server\
echo       windows\native\steamcmd\ linux\native\steamcmd\
echo       frontend\node_modules\   frontend\packages\web\dist\
pause
exit /b 1

:fail
echo [X] 打包失敗,請截圖上方訊息求助。
pause
exit /b 1
