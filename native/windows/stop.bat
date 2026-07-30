@echo off
chcp 65001 >nul
title Palworld 停止(原生)
echo 正在停止 Palworld 伺服器...
taskkill /im PalServer-Win64-Shipping-Cmd.exe /t /f >nul 2>nul
taskkill /im PalServer-Win64-Shipping.exe /t /f >nul 2>nul
taskkill /im PalServer.exe /t /f >nul 2>nul
echo 已停止。伺服器每 30 秒自動存檔,最多遺失最近 30 秒進度。
pause
