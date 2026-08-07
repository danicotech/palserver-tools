@echo off
rem Print the connection info (URL, port, passwords) that is actually in effect.
rem
rem This used to be pure batch. It printed a lot of CJK, interpolated variables,
rem and used goto/call - and that combination breaks under codepage 65001:
rem cmd resumes a goto by BYTE OFFSET, the multi-byte text earlier in the file
rem shifts those offsets, and execution lands in the middle of a line. The tail
rem then runs as a command:
rem
rem     'xxxxx' is not recognized as an internal or external command
rem
rem ui.bat dodges this by keeping CJK in .txt files printed with "type", but
rem here the text has to embed live values, so type is not enough. The whole
rem body moved to backend\tools\show_info.py and this file stays pure ASCII.
rem   %1 = server dir, %2 = web panel port (default 9000)
chcp 65001 >nul
setlocal
set "PANELPORT=%~2"
if "%PANELPORT%"=="" set "PANELPORT=9000"

where python >nul 2>nul
if errorlevel 1 goto :nopython
python "%~dp0..\..\backend\tools\show_info.py" "%~1" "%PANELPORT%"
exit /b 0

:nopython
rem No Python: fall back to the bare minimum, ASCII only.
echo.
echo ==================================================
echo   Panel : http://localhost:%PANELPORT%
echo   Game  : this machine, UDP port 8211 by default
echo   Settings: %~1\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini
echo ==================================================
echo.
exit /b 0
