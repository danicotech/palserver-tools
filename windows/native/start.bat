@echo off
chcp 65001 >nul
setlocal
rem Server dir: windows\native\server now, windows\server before 1.0.2
set "SRVDIR=%~dp0server"
if not exist "%SRVDIR%\PalServer.exe" if exist "%~dp0..\server\PalServer.exe" set "SRVDIR=%~dp0..\server"
cd /d "%SRVDIR%"
title Palworld 伺服器(原生)

rem Same rule as install.bat: single-line + goto, never multi-line if(...).

if not exist "PalServer.exe" goto :noserver

rem First run: seed an editable config from the official defaults. Native mode
if exist "Pal\Saved\Config\WindowsServer\PalWorldSettings.ini" goto :run
mkdir "Pal\Saved\Config\WindowsServer" 2>nul
copy /y "DefaultPalWorldSettings.ini" "Pal\Saved\Config\WindowsServer\PalWorldSettings.ini" >nul
echo 已建立設定檔:Pal\Saved\Config\WindowsServer\PalWorldSettings.ini
echo 想改伺服器名稱/密碼/倍率就編輯它,改完重開本視窗。

:run
echo 啟動中... 關閉伺服器請用 stop.bat(直接關視窗可能遺失進度)
start "PalServer" PalServer.exe -publicport=8211 -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS
echo 伺服器已在背景啟動。遊戲連線:你的IP:8211(UDP)
pause
exit /b 0

:noserver
echo [X] 尚未安裝,請先雙擊 install.bat
pause
exit /b 1
