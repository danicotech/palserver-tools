@echo off
rem Shared colors + branded banner. Comments are ASCII on purpose:
rem cmd parses batch files bytewise under codepage 65001 and can split
rem lines that contain multi-byte characters, executing the tail as a
rem garbage command. So this file stays ASCII, and all CJK banner text
rem lives in banner-*.txt printed via "type" (never parsed by cmd).
rem Usage: call ui.bat            -> set color vars only
rem        call ui.bat "title" "subtitle" -> also print the banner
for /f %%a in ('echo prompt $E^|cmd') do set "VT=%%a"
set "T=%VT%[96m"
set "H=%VT%[1;97m"
set "G=%VT%[92m"
set "Y=%VT%[93m"
set "X=%VT%[91m"
set "K=%VT%[1;93m"
set "R=%VT%[0m"
if "%~1"=="" exit /b 0
type "%~dp0banner-head.txt"
echo   %H%%~1%R%
if not "%~2"=="" echo   %~2
type "%~dp0banner-foot.txt"
exit /b 0
