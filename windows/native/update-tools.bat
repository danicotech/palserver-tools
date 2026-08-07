@echo off
rem Update the panel and scripts to the latest release, keeping user data.
rem
rem The download only contains version-controlled files, so config.json, .env,
rem backend\data, windows\native\server and windows\native\tools are simply not
rem in it - they cannot be overwritten. That is safer than maintaining a list of
rem things to exclude: a list can miss something, "not present in the source"
rem cannot.
rem
rem Body lives in backend\tools\update_tools.py. This file stays pure ASCII:
rem cmd resumes a goto by byte offset, and CJK earlier in a batch file shifts
rem those offsets until execution lands mid-line and runs the tail as a command.
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
call "%~dp0use-tools.bat"

where python >nul 2>nul
if errorlevel 1 goto :nopython
python "backend\tools\update_tools.py" "%CD%" %*
pause
exit /b 0

:nopython
echo [X] Python not found. Run windows\native\install.bat first,
echo     or download the zip from GitHub and extract it over this folder.
pause
exit /b 1
