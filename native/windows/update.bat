@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Palworld 更新(原生)
echo 更新前請先用 stop.bat 停止伺服器。
steamcmd\steamcmd.exe +force_install_dir "%~dp0..\server" +login anonymous +app_update 2394010 validate +quit
echo 更新完成!雙擊 start.bat 重新啟動。
pause
