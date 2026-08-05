@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 帕魯全套服務 - 停止(SteamCMD 版)

echo 正在停止排程器與存檔解析...
rem palsave is a child of the scheduler now, so /t takes it down as well.
rem Older builds opened one window each; keep the title match so those stop too.
taskkill /im palscheduler.exe /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq palscheduler*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq palsave*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq 存檔解析*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq 排程器*" /t /f >nul 2>nul

rem Safety net: if the scheduler was killed hard (window closed with no clean
rem shutdown event) palsave can be orphaned holding 8213 and break the next run.
rem Find the PID by who listens on 8213 -- wmic is gone from Windows 11.
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:"LISTENING" ^| findstr /c:":8213"') do (
  if not "%%p"=="0" taskkill /pid %%p /f >nul 2>nul
)

echo 正在停止遊戲伺服器(會先存檔)...
taskkill /im PalServer-Win64-Shipping-Cmd.exe /t >nul 2>nul
taskkill /im PalServer-Win64-Shipping.exe /t >nul 2>nul
timeout /t 5 /nobreak >nul
taskkill /im PalServer-Win64-Shipping-Cmd.exe /t /f >nul 2>nul
taskkill /im PalServer-Win64-Shipping.exe /t /f >nul 2>nul
taskkill /im PalServer.exe /t /f >nul 2>nul

echo 已全部停止。要再開就雙擊 start-all.bat。
pause
