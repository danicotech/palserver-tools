@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Palworld 更新(原生)

if not exist "steamcmd\steamcmd.exe" goto :nosteamcmd
echo 更新前請先用 stop.bat 停止伺服器。
set "SRVDIR=%~dp0server"
if not exist "%SRVDIR%\PalServer.exe" if exist "%~dp0..\server\PalServer.exe" set "SRVDIR=%~dp0..\server"
"%~dp0steamcmd\steamcmd.exe" +force_install_dir "%SRVDIR%" +login anonymous +app_update 2394010 validate +quit
if errorlevel 1 goto :fail
echo 更新完成!雙擊 start.bat 重新啟動。
pause
exit /b 0

:nosteamcmd
echo [X] 找不到 SteamCMD,請先雙擊 install.bat
pause
exit /b 1

:fail
echo [X] 更新失敗(下載中斷或伺服器還開著)。停掉伺服器後重跑本檔會續傳。
pause
exit /b 1
