@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 帕魯全套服務 - 停止(SteamCMD 版)

echo 正在停止排程器與存檔解析...
rem palsave 現在是排程器的子行程,/t 會連它一起帶走。
rem 舊版把兩者各開一個視窗,標題比對留著,讓舊版裝機也停得掉。
taskkill /im palscheduler.exe /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq palscheduler*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq palsave*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq 存檔解析*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq 排程器*" /t /f >nul 2>nul

rem 保險:排程器若是被強制砍掉(例如直接關視窗又沒收到關閉事件),
rem palsave 可能變成孤兒繼續佔著 8213,下次啟動就會失敗。
rem 用「誰在聽 8213」反查 PID 來收尾 —— 不依賴已被 Windows 11 移除的 wmic。
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
