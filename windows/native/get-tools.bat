@echo off
chcp 65001 >nul
rem Ensure Python / Node / Go are usable: reuse whatever the system has,
rem otherwise download the official portable build into
rem windows\native\tools\ -- no system changes, no admin rights, no winget.
rem Usable right away because use-tools.bat already put tools\ on PATH,
rem so there is never a 'close the window and rerun' step.
rem Usage: get-tools.bat python^|node^|go
setlocal
call "%~dp0use-tools.bat"
set "TOOLS=%~dp0tools"
if not exist "%TOOLS%" mkdir "%TOOLS%"
if /i "%~1"=="python" goto :python
if /i "%~1"=="node" goto :node
if /i "%~1"=="go" goto :go
echo [X] 用法:get-tools.bat python^|node^|go
exit /b 1

:python
rem 'force' skips the system check and installs the portable build anyway.
rem Used when the system Python exists but cannot install our wheels.
if /i "%~2"=="force" goto :pyget
where python >nul 2>nul
if not errorlevel 1 exit /b 0
:pyget
if /i "%~2"=="force" echo       改用專案內建的 Python 3.12(不動系統上的那個)...
if /i not "%~2"=="force" echo       這台電腦沒有 Python,下載官方可攜版(約 11 MB,只放進專案資料夾)...
if exist "%TOOLS%\python" rd /s /q "%TOOLS%\python"
curl -L --fail -o "%TOOLS%\python.zip" "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
if errorlevel 1 goto :pyfail
mkdir "%TOOLS%\python"
tar -xf "%TOOLS%\python.zip" -C "%TOOLS%\python"
if errorlevel 1 goto :pyfail
del /f /q "%TOOLS%\python.zip"
rem The embeddable build ships with 'import site' commented out in ._pth,
(echo python312.zip& echo .& echo Lib\site-packages& echo import site)> "%TOOLS%\python\python312._pth"
rem so pip-installed packages stay invisible. Rewrite it, then add pip
curl -L --fail -o "%TOOLS%\python\get-pip.py" "https://bootstrap.pypa.io/get-pip.py"
if errorlevel 1 goto :pyfail
"%TOOLS%\python\python.exe" "%TOOLS%\python\get-pip.py" --no-warn-script-location
if errorlevel 1 goto :pyfail
where python >nul 2>nul
if errorlevel 1 goto :pyfail
exit /b 0
:pyfail
echo [X] Python 可攜版安裝失敗(網路問題,或防毒暫時鎖住剛解壓的檔案)。重跑一次通常就好;
echo       https://www.python.org/downloads/  (安裝時勾選 Add python.exe to PATH)
exit /b 1

:node
rem 'force' skips the system check and installs the portable build anyway.
if /i "%~2"=="force" goto :nodeget
where node >nul 2>nul
if errorlevel 1 goto :nodeget
rem Presence is not enough - the version matters. The pnpm we install needs
rem Node >= 22.13; on an older Node, npm installs pnpm with only a warning and
rem then pnpm cannot run at all, so the install dies at step 4 saying it
rem could not install pnpm. Comments stay ASCII: under codepage 65001 cmd
rem splits lines holding multi-byte characters and runs the tail.
set "_nodemaj=0"
for /f "tokens=1 delims=.v" %%v in ('node -p "process.versions.node"') do set "_nodemaj=%%v"
if %_nodemaj% GEQ 22 exit /b 0
echo       系統的 Node 太舊(v%_nodemaj%.x,pnpm 需要 22 以上),改用專案內建的...
:nodeget
echo       這台電腦沒有 Node.js,下載官方可攜版(約 30 MB,只放進專案資料夾)...
if exist "%TOOLS%\node" rd /s /q "%TOOLS%\node"
if exist "%TOOLS%\node-v22.14.0-win-x64" rd /s /q "%TOOLS%\node-v22.14.0-win-x64"
curl -L --fail -o "%TOOLS%\node.zip" "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip"
if errorlevel 1 goto :nodefail
tar -xf "%TOOLS%\node.zip" -C "%TOOLS%"
if errorlevel 1 goto :nodefail
del /f /q "%TOOLS%\node.zip"
rem Renaming right after tar can hit a transient lock (antivirus or the search
rem indexer is still scanning the 30 MB we just wrote), so retry a few times.
set /a _try=0
:noderen
ren "%TOOLS%\node-v22.14.0-win-x64" node 2>nul
if exist "%TOOLS%\node\node.exe" goto :nodedone
set /a _try+=1
if %_try% GEQ 10 goto :nodefail
timeout /t 1 /nobreak >nul
goto :noderen
:nodedone
where node >nul 2>nul
if errorlevel 1 goto :nodefail
exit /b 0
:nodefail
echo [X] Node.js 可攜版安裝失敗(網路問題,或防毒暫時鎖住剛解壓的檔案)。重跑一次通常就好;
echo       https://nodejs.org/
exit /b 1

:go
where go >nul 2>nul
if not errorlevel 1 exit /b 0
rem via the official get-pip.py (the embeddable build has no pip).
echo       這台電腦沒有 Go,下載官方可攜版(約 80 MB,只放進專案資料夾)...
if exist "%TOOLS%\go" rd /s /q "%TOOLS%\go"
curl -L --fail -o "%TOOLS%\go.zip" "https://go.dev/dl/go1.26.1.windows-amd64.zip"
if errorlevel 1 goto :gofail
tar -xf "%TOOLS%\go.zip" -C "%TOOLS%"
if errorlevel 1 goto :gofail
del /f /q "%TOOLS%\go.zip"
where go >nul 2>nul
if errorlevel 1 goto :gofail
exit /b 0
:gofail
echo [X] Go 可攜版安裝失敗(網路問題,或防毒暫時鎖住剛解壓的檔案)。重跑一次通常就好;
echo       https://go.dev/dl/
exit /b 1
