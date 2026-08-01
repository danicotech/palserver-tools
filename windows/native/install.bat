@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Palworld 原生安裝(SteamCMD)

rem 這裡刻意不用 if (...) 多行區塊 —— 那種寫法只要檔案換行不是 CRLF,
rem cmd 就會把區塊拆爛,出現「'cmd.zip' 不是內部或外部命令」、
rem 多出一個名為 ( 的資料夾、甚至在別的磁碟建 steamcmd 之類的怪現象。
rem 一律單行 + goto:就算換行被改動過,最壞情況也只是停在錯誤訊息。

if exist "steamcmd\steamcmd.exe" goto :install
echo [1/3] 下載 SteamCMD...
if exist "steamcmd.zip" del /f /q "steamcmd.zip"
curl -L --fail -o "steamcmd.zip" "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
if errorlevel 1 goto :dlfail
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath 'steamcmd.zip' -DestinationPath 'steamcmd'"
if errorlevel 1 goto :unzipfail
del /f /q "steamcmd.zip"
if not exist "steamcmd\steamcmd.exe" goto :unzipfail

:install
echo [2/3] 安裝/驗證 Palworld 專用伺服器(第一次約需下載數 GB)...
"%~dp0steamcmd\steamcmd.exe" +force_install_dir "%~dp0..\server" +login anonymous +app_update 2394010 validate +quit
if errorlevel 1 goto :appfail
if not exist "%~dp0..\server\PalServer.exe" goto :appfail

echo [3/3] 完成!接著雙擊 start.bat 啟動伺服器。
pause
exit /b 0

:dlfail
echo [X] SteamCMD 下載失敗,請檢查網路後重跑本檔。
pause
exit /b 1

:unzipfail
echo [X] SteamCMD 解壓縮失敗。請刪掉本資料夾底下的 steamcmd 與 steamcmd.zip 後重跑。
pause
exit /b 1

:appfail
echo [X] 伺服器安裝失敗(下載中斷或磁碟空間不足)。重跑本檔會從中斷處續傳。
pause
exit /b 1
