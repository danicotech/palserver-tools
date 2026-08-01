@echo off
chcp 65001 >nul
cd /d "%~dp0..\server"
title Palworld 伺服器(原生)

if not exist PalServer.exe ( echo [X] 尚未安裝,請先雙擊 install.bat & pause & exit /b 1 )

rem 第一次啟動:用官方預設檔建立可編輯的設定檔(原生模式不會被覆寫,放心改)
if not exist "Pal\Saved\Config\WindowsServer\PalWorldSettings.ini" (
  mkdir "Pal\Saved\Config\WindowsServer" 2>nul
  copy /y "DefaultPalWorldSettings.ini" "Pal\Saved\Config\WindowsServer\PalWorldSettings.ini" >nul
  echo 已建立設定檔:Pal\Saved\Config\WindowsServer\PalWorldSettings.ini
  echo 想改伺服器名稱/密碼/倍率就編輯它,改完重開本視窗。
)

echo 啟動中... 關閉伺服器請用 stop.bat(直接關視窗可能遺失進度)
start "PalServer" PalServer.exe -publicport=8211 -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS
echo 伺服器已在背景啟動。遊戲連線:你的IP:8211(UDP)
pause
