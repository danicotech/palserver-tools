@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\server"
title Palworld 伺服器(原生)

rem 同 install.bat:一律單行 + goto,避免多行 if(...) 在非 CRLF 換行時被 cmd 拆爛。

if not exist "PalServer.exe" goto :noserver

rem 第一次啟動:用官方預設檔建立可編輯的設定檔(原生模式不會被覆寫,放心改)
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
