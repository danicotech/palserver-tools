@echo off
rem Asks which Palworld server folder to use, and remembers the answer.
rem
rem Why this exists: start-all used to hardcode the bundled server folder, so
rem anyone who had already been running a SteamCMD server somewhere else (another
rem drive, an older install, a server with months of saves) had no way to point
rem the panel at it short of moving a 6 GB install. Nothing is copied or moved
rem here - we only record which folder to use.
rem
rem The answer lands in backend\data\server-dir.txt. start-all reads it and sets
rem   SERVER_DIR : which server the scheduler starts and stops
rem   SAVE_ROOT  : whose saves the panel shows
rem Both point at the same folder, because a SteamCMD install keeps PalServer.exe
rem and Pal\Saved side by side.
rem
rem One prompt, not two: the answer may be a menu number OR a pasted path. Under
rem codepage 65001 cmd's set /p cannot read redirected input at all, so every
rem extra prompt is one more step that can never be covered by an automated test.
rem
rem Comments are English on purpose: under codepage 65001 cmd parses batch files
rem bytewise and can split a line holding multi-byte characters, then run the
rem tail as a command. Single-line if + goto only, for the same parser reason.
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0..\.."
rem Only when run on its own: start-all already set the colors, and ui.bat's
rem "for /f ... | cmd" trick for the ESC byte disturbs inherited stdin.
if not defined R call "%~dp0ui.bat"
set "STORE=%CD%\backend\data\server-dir.txt"
if not exist "%CD%\backend\data" mkdir "%CD%\backend\data" >nul 2>nul

set "CUR="
if exist "%STORE%" for /f "usebackq delims=" %%a in ("%STORE%") do set "CUR=%%~a"
if not defined CUR goto :ask

rem A remembered folder still has to exist. Drives get unplugged and folders get
rem renamed; starting a server against a path that is gone is worse than asking.
call :describe "!CUR!"
if errorlevel 1 goto :stale
echo.
echo   %H%目前使用的伺服器資料夾%R%
echo     %K%"!CUR!"%R%
echo     !DESC!
echo.
set "SEL="
set /p "SEL=  按 Enter 直接用這個,或輸入 C 換一個: "
if /i not "!SEL!"=="C" goto :done
goto :ask

:stale
echo.
echo   %Y%[!]%R% 上次記住的資料夾現在讀不到了:
echo       "!CUR!"
echo       (磁碟沒接上、資料夾被搬走或改名都會這樣)
set "CUR="

:ask
set "N=0"
echo.
echo   %H%請選擇你的帕魯伺服器資料夾%R%
echo     就是放著 PalServer.exe 和 Pal\Saved 的那一層。
echo     選好之後,排程器會直接開關那台伺服器、面板也讀它的存檔 —— 不會搬動任何檔案。
echo.
echo     搜尋常見安裝位置中...
call :addcand "%CD%\windows\native\server"
call :addcand "%CD%\windows\server"
for %%i in ("%CD%\..") do call :addcand "%%~fi"
for %%d in (C D E F G H I J) do call :probedrive %%d
echo.
if "%N%"=="0" echo   %Y%這台電腦上沒有自動找到,請直接貼上資料夾路徑。%R%
for /l %%i in (1,1,%N%) do call :showcand %%i

:prompt
echo.
echo     不在上面的話,直接把資料夾路徑貼進來就好
echo     (檔案總管對著資料夾 Shift+右鍵 -^> 複製路徑;例如 D:\steamcmd\steamapps\common\PalServer)
set "SEL="
if not "%N%"=="0" set /p "SEL=  輸入編號或路徑(直接按 Enter = 1): "
if "%N%"=="0" set /p "SEL=  請貼上資料夾完整路徑: "
if not defined SEL if not "%N%"=="0" set "SEL=1"
if not defined SEL goto :nopath
rem Explorer's "Copy as path" wraps the path in quotes; strip them and any
rem trailing backslash so the checks below see a clean path.
set SEL=!SEL:"=!
if "!SEL:~-1!"=="\" set "SEL=!SEL:~0,-1!"
rem A bare number picks from the menu; anything else is treated as a path.
echo(!SEL!| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 goto :aspath
set "CUR=!CAND_%SEL%!"
if not defined CUR goto :badsel
goto :done

:aspath
set "CUR=!SEL!"
call :describe "!CUR!"
if errorlevel 2 goto :noexe
if errorlevel 1 goto :nodir
goto :done

:badsel
echo   %X%[X]%R% 沒有編號 !SEL!,請輸入 1 到 %N% 之間的編號,或直接貼路徑。
set "CUR="
goto :prompt

:nopath
echo   %X%[X]%R% 沒有輸入任何路徑。
goto :prompt

:nodir
echo   %X%[X]%R% 找不到這個資料夾:
echo       "!CUR!"
set "CUR="
goto :prompt

:noexe
echo   %X%[X]%R% 這個資料夾裡沒有 PalServer.exe:
echo       "!CUR!"
echo       要指到伺服器安裝的那一層(裡面看得到 PalServer.exe 和 Pal 資料夾),
echo       不是 Pal\Saved\SaveGames 那一層,也不是 Level.sav 本身。
set "CUR="
goto :prompt

:done
rem Written with quotes so paths containing ^& survive; start-all strips them
rem again with %%~a when it reads the file back.
>"%STORE%" echo "!CUR!"
call :describe "!CUR!"
echo.
echo   %G%[OK]%R% 使用這個資料夾:%K%"!CUR!"%R%
echo         !DESC!
echo         下次啟動會直接沿用;要換的話在上面那一步輸入 C。
endlocal
exit /b 0

rem Paths are echoed inside quotes on purpose: an unquoted ^& ends the echo and
rem cmd then tries to run the rest of the path as a command.

rem ---- helpers ----------------------------------------------------------

rem describe <dir> -> DESC, plus an exit code saying whether it is usable.
rem   0 = usable   1 = folder missing   2 = folder exists but no PalServer.exe
:describe
set "DESC="
set "D=%~1"
if "%D%"=="" exit /b 1
if not exist "%D%\" exit /b 1
if not exist "%D%\PalServer.exe" exit /b 2
set "W=0"
if exist "%D%\Pal\Saved\SaveGames\0\" for /d %%s in ("%D%\Pal\Saved\SaveGames\0\*") do if exist "%%s\Level.sav" set /a W+=1
set "DESC=有伺服器本體"
if "%W%"=="0" set "DESC=%DESC% · 還沒有存檔(第一次開服後才會產生)"
if not "%W%"=="0" set "DESC=%DESC% · %W% 個世界存檔"
exit /b 0

rem addcand <dir> -> append to the menu if usable and not already listed.
:addcand
call :describe "%~1"
if errorlevel 1 exit /b 0
for /l %%i in (1,1,%N%) do if /i "!CAND_%%i!"=="%~1" exit /b 0
set /a N+=1
set "CAND_!N!=%~1"
set "DESC_!N!=!DESC!"
exit /b 0

:showcand
echo     %K%[%~1]%R% "!CAND_%~1!"
echo         !DESC_%~1!
exit /b 0

rem Probe the usual SteamCMD / Steam library layouts on one drive. Cheap enough
rem to run for every drive letter, and it is what finds a server sitting on D:
rem without making the user hunt for the path.
:probedrive
if not exist "%~1:\" exit /b 0
call :addcand "%~1:\steamcmd\steamapps\common\PalServer"
call :addcand "%~1:\SteamLibrary\steamapps\common\PalServer"
call :addcand "%~1:\Steam\steamapps\common\PalServer"
call :addcand "%~1:\Games\steamapps\common\PalServer"
call :addcand "%~1:\Program Files (x86)\Steam\steamapps\common\PalServer"
call :addcand "%~1:\PalServer"
call :addcand "%~1:\palworld\PalServer"
call :addcand "%~1:\palworld-server"
exit /b 0
