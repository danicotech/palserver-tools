@echo off
chcp 65001 >nul
setlocal
title 帕魯全套服務 - 停止(SteamCMD 版)

echo 正在停止排程器與存檔解析...
taskkill /fi "WINDOWTITLE eq palscheduler*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq palsave*" /t /f >nul 2>nul
taskkill /im palscheduler.exe /t /f >nul 2>nul

echo 正在停止遊戲伺服器(會先存檔)...
taskkill /im PalServer-Win64-Shipping-Cmd.exe /t >nul 2>nul
taskkill /im PalServer-Win64-Shipping.exe /t >nul 2>nul
timeout /t 5 /nobreak >nul
taskkill /im PalServer-Win64-Shipping-Cmd.exe /t /f >nul 2>nul
taskkill /im PalServer-Win64-Shipping.exe /t /f >nul 2>nul
taskkill /im PalServer.exe /t /f >nul 2>nul

echo 已全部停止。要再開就雙擊 start-all.bat。
pause
