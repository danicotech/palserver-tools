@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Palworld 原生安裝(SteamCMD)

if not exist steamcmd\steamcmd.exe (
  echo [1/3] 下載 SteamCMD...
  curl -L -o steamcmd.zip https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip
  if errorlevel 1 ( echo [X] 下載失敗,請檢查網路後重試 & pause & exit /b 1 )
  powershell -NoProfile -Command "Expand-Archive -Force steamcmd.zip steamcmd"
  del steamcmd.zip
)

echo [2/3] 安裝/驗證 Palworld 專用伺服器(第一次約需下載數 GB)...
steamcmd\steamcmd.exe +force_install_dir "%~dp0..\server" +login anonymous +app_update 2394010 validate +quit
if errorlevel 1 ( echo [X] 安裝失敗,重跑本檔可續傳 & pause & exit /b 1 )

echo [3/3] 完成!接著雙擊 start.bat 啟動伺服器。
pause
