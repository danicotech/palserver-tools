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
if "%N%"=="0" echo   %Y%這台電腦上沒有自動找到,請自己輸入路徑。%R%
for /l %%i in (1,1,%N%) do call :showcand %%i
echo     %K%[M]%R% 我自己輸入路徑

:prompt
echo.
set "SEL="
if not "%N%"=="0" set /p "SEL=  輸入編號、M、或直接貼上路徑(按 Enter = 1): "
if "%N%"=="0" goto :manual
if not defined SEL set "SEL=1"
if /i "!SEL!"=="M" goto :manual
goto :clean

:manual
echo.
echo     請輸入伺服器安裝資料夾的完整路徑。
echo     在檔案總管對著資料夾按 Shift+右鍵 -^> 「複製路徑」再貼上最快。
echo     例如 D:\steamcmd\steamapps\common\PalServer
echo     貼到裡面幾層(甚至貼到 Level.sav)也沒關係,會自動往上對正。
set "SEL="
set /p "SEL=  路徑: "
if not defined SEL goto :nopath

:clean
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
rem Accept anything that leads to a server: the folder itself, something inside
rem it (Pal\Saved\...\Level.sav is a very easy thing to copy by mistake), or a
rem folder holding it (D:\steamcmd -> steamapps\common\PalServer).
call :resolve "!SEL!"
if not defined RESOLVED goto :nofound
set "CUR=!RESOLVED!"
if /i "!CUR!"=="!SEL!" goto :done
echo   %Y%[!]%R% 你輸入的不是伺服器那一層,已自動對正到:
echo       %K%"!CUR!"%R%
goto :done

:badsel
echo   %X%[X]%R% 沒有編號 !SEL!,請輸入 1 到 %N% 之間的編號,或直接貼路徑。
set "CUR="
goto :prompt

:nopath
echo   %X%[X]%R% 沒有輸入任何路徑。
goto :prompt

:nofound
echo.
if not exist "!SEL!" echo   %X%[X]%R% 這個路徑不存在:"!SEL!"
if exist "!SEL!" echo   %X%[X]%R% 這條路徑上下都找不到 PalServer.exe:"!SEL!"
echo       已經檢查過:這個資料夾本身、往上每一層、以及往下三層。
echo       請指到伺服器安裝的那一層 —— 裡面看得到 PalServer.exe 和 Pal 資料夾。
echo       還沒安裝過伺服器的話,先跑 windows
ative\install.bat。
set "CUR="
goto :prompt

:done
rem Say what was actually found before committing to it. A path that merely
rem "looks right" is the thing that wastes an evening: the server starts, the
rem panel stays empty, and nobody can tell which of the two points elsewhere.
call :describe "!CUR!"
echo.
echo   %H%檢查結果%R%
echo     資料夾        %G%OK%R%  "!CUR!"
echo     PalServer.exe %G%OK%R%
if not exist "!CUR!\Pal\Saved\SaveGames" echo     存檔資料夾    %Y%尚未產生%R%  第一次開服後才會出現,這是正常的
if exist "!CUR!\Pal\Saved\SaveGames" echo     存檔資料夾    %G%OK%R%  找到 !W! 個世界
for /l %%i in (1,1,!W!) do call :showworld %%i
rem Written with quotes so paths containing ^& survive; start-all strips them
rem again with %%~a when it reads the file back.
>"%STORE%" echo "!CUR!"
echo.
echo   %G%[OK]%R% 就用這個資料夾啟動,不會搬動裡面任何檔案。
echo         記在 backend\data\server-dir.txt,下次直接沿用;要換就在提問時輸入 C。
endlocal
exit /b 0

rem Paths are echoed inside quotes on purpose: an unquoted ^& ends the echo and
rem cmd then tries to run the rest of the path as a command.

rem resolve <path> -> RESOLVED = the folder that actually holds PalServer.exe.
rem People paste whatever they happen to have: the install folder, a save file
rem deep inside it, or the folder above it. Walking up and then down turns all
rem three into the one answer we need, instead of bouncing them back with a
rem bare "not found" and no hint about which level was wrong.
rem Up wins over down when both could match: a path pasted from inside an
rem install is far more common than one that happens to sit above another.
:resolve
set "RESOLVED="
set "P=%~1"
if "%P%"=="" exit /b 1
set "UP=0"
:rup
if exist "%P%\PalServer.exe" goto :rfound
set /a UP+=1
if %UP% gtr 8 goto :rdown
for %%i in ("%P%") do set "P=%%~dpi"
if "%P:~-1%"=="\" set "P=%P:~0,-1%"
if "%P%"=="" goto :rdown
rem Stop at the drive root. Asking for the parent of a bare "C:" gives that
rem drive's CURRENT directory, not the root, so one more step would wander into
rem wherever this script was launched from and match an unrelated server.
rem (Do not write the tilde-path operator in a comment either - cmd expands it
rem inside rem lines too and fails with "invalid usage of the path operator".)
if "%P:~-1%"==":" goto :rdown
goto :rup
:rfound
set "RESOLVED=%P%"
exit /b 0

rem Three levels down covers D:\steamcmd -> steamapps\common\PalServer, and is
rem bounded on purpose: a recursive scan of a whole drive would hang for minutes.
:rdown
for /d %%a in ("%~1\*") do if exist "%%a\PalServer.exe" set "RESOLVED=%%~fa"
if defined RESOLVED exit /b 0
for /d %%a in ("%~1\*") do for /d %%b in ("%%a\*") do if exist "%%b\PalServer.exe" set "RESOLVED=%%~fb"
if defined RESOLVED exit /b 0
for /d %%a in ("%~1\*") do for /d %%b in ("%%a\*") do for /d %%c in ("%%b\*") do if exist "%%c\PalServer.exe" set "RESOLVED=%%~fc"
if defined RESOLVED exit /b 0
exit /b 1

:showworld
echo       - !WORLD_%~1!
exit /b 0

rem addworld <dir> -> count one world and remember its name and last save time,
rem so the user can recognise their own world instead of trusting a bare count.
:addworld
set /a W+=1
for %%d in ("%~1") do set "WNAME=%%~nxd"
for %%f in ("%~1\Level.sav") do set "WORLD_!W!=!WNAME!  最後存檔 %%~tf"
exit /b 0

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
if exist "%D%\Pal\Saved\SaveGames\0\" for /d %%s in ("%D%\Pal\Saved\SaveGames\0\*") do if exist "%%s\Level.sav" call :addworld "%%s"
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
