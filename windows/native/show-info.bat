@echo off
rem 顯示「現在到底用哪個埠、密碼是什麼」——純 batch,不需要 PowerShell。
rem SteamCMD 版的伺服器設定在 PalWorldSettings.ini(不是 .env),
rem 所有值都塞在同一行 OptionSettings 裡,這裡用字串切割取出來。
rem   %1 = 伺服器資料夾  %2 = 查詢網站的埠(預設 9000)
chcp 65001 >nul
setlocal enabledelayedexpansion
set "SRVDIR=%~1"
set "PANELPORT=%~2"
if "%PANELPORT%"=="" set "PANELPORT=9000"
set "INI=%SRVDIR%\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini"

rem 區網 IP(找第一個非 127./169.254. 的 IPv4)
set "LANIP=你的IP"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    if "!LANIP!"=="你的IP" if not "%%b"=="127.0.0.1" set "LANIP=%%b"
  )
)

set "PORT=8211"
set "PW="
set "ADMINPW="
set "SRVNAME="
set "RESTON="
if not exist "%INI%" goto :noini
for /f "usebackq delims=" %%L in (`findstr /c:"OptionSettings" "%INI%"`) do set "OPT=%%L"
call :getval PublicPort PORT
call :getval ServerPassword PW
call :getval AdminPassword ADMINPW
call :getval ServerName SRVNAME
call :getval RESTAPIEnabled RESTON
if "%PORT%"=="" set "PORT=8211"

:show
echo.
echo ==================================================
echo   連線資訊
echo ==================================================
echo   查詢網站   http://localhost:%PANELPORT%   (區網 http://%LANIP%:%PANELPORT%)
echo   遊戲連線   %LANIP%:%PORT%   (UDP,同一台可用 127.0.0.1:%PORT%)
if "%PW%"=="" (echo   進服密碼   (沒有設密碼,直接連^)) else (echo   進服密碼   %PW%)
if "%ADMINPW%"=="" (echo   管理密碼   (沒有設^)) else (echo   管理密碼   %ADMINPW%)
if not "%SRVNAME%"=="" echo   伺服器名稱 %SRVNAME%
echo --------------------------------------------------
if not exist "%INI%" goto :hint_noini
echo   改密碼/埠/倍率就編輯這個檔,存檔後重開伺服器:
echo     %INI%
if /i not "%RESTON%"=="True" echo   提示:RESTAPIEnabled=False —— 網站看不到在線玩家與即時位置,建議改成 True。
goto :done
:hint_noini
echo   設定檔還沒產生(伺服器第一次啟動後才會出現):
echo     %INI%
echo   在那之前是官方預設值:無密碼、埠 8211。
:done
echo ==================================================
echo.
exit /b 0

:noini
goto :show

rem ---------- 子程序:從 OptionSettings 取出某個鍵的值 ----------
rem   %1 = 鍵名  %2 = 要寫回的變數名
:getval
setlocal enabledelayedexpansion
set "V="
if not defined OPT goto :getdone
rem 切掉「鍵名」之前的全部內容,剩下 =值,後面還有其他鍵
set "REST=!OPT:*%~1=!"
if "!REST!"=="!OPT!" goto :getdone
set "REST=!REST:~1!"
for /f "tokens=1 delims=,)" %%v in ("!REST!") do set "V=%%v"
rem 去掉包住值的雙引號
if defined V set V=!V:"=!
:getdone
endlocal & set "%~2=%V%"
exit /b 0
