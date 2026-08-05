@echo off
rem 共用配色與橫幅(Win10 之後的主控台都支援 VT 逃逸碼)。
rem 用 prompt $E 技巧取得 ESC 字元;變數名刻意超短 —— 批次檔要守 8KB
rem (理由見 get-tools.bat 開頭)。本檔不能 setlocal,呼叫者要拿到這些變數。
rem 用法:call ui.bat            → 只設定顏色變數
rem       call ui.bat "標題" "副標" → 順便印橫幅
for /f %%a in ('echo prompt $E^|cmd') do set "VT=%%a"
set "T=%VT%[96m"
set "H=%VT%[1;97m"
set "G=%VT%[92m"
set "Y=%VT%[93m"
set "X=%VT%[91m"
set "K=%VT%[1;93m"
set "R=%VT%[0m"
if "%~1"=="" exit /b 0
echo %T%════════════════════════════════════════════════════════%R%
echo   %H%%~1%R%
if not "%~2"=="" echo   %~2
echo %T%════════════════════════════════════════════════════════%R%
exit /b 0
