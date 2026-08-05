@echo off
chcp 65001 >nul
rem 確保 Python / Node / Go 可用:系統已有就直接用;沒有就下載「官方可攜版」
rem 到 windows\native\tools\ —— 不動系統、免管理員權限、免 winget,
rem 下載完當場能用(use-tools.bat 已把 tools\ 排進 PATH),不會出現
rem 「裝完要關視窗重跑一次」。用法:get-tools.bat python^|node^|go
rem 注意:本檔要維持在 8 KB 以下 —— cmd 讀 UTF-8 批次檔時,讀取區塊(8191 位元組)
rem 的邊界若落在中文字中間,那一行會被拆成亂碼指令。小檔沒有邊界,天生安全。
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
where python >nul 2>nul
if not errorlevel 1 exit /b 0
echo       這台電腦沒有 Python,下載官方可攜版(約 11 MB,只放進專案資料夾)...
if exist "%TOOLS%\python" rd /s /q "%TOOLS%\python"
curl -L --fail -o "%TOOLS%\python.zip" "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
if errorlevel 1 goto :pyfail
mkdir "%TOOLS%\python"
tar -xf "%TOOLS%\python.zip" -C "%TOOLS%\python"
if errorlevel 1 goto :pyfail
del /f /q "%TOOLS%\python.zip"
rem 可攜版預設不載入 site-packages(._pth 註解掉 import site),pip 裝了也看不到;改寫它
(echo python312.zip& echo .& echo Lib\site-packages& echo import site)> "%TOOLS%\python\python312._pth"
rem 可攜版沒附 pip,用官方 get-pip.py 補上
curl -L --fail -o "%TOOLS%\python\get-pip.py" "https://bootstrap.pypa.io/get-pip.py"
if errorlevel 1 goto :pyfail
"%TOOLS%\python\python.exe" "%TOOLS%\python\get-pip.py" --no-warn-script-location
if errorlevel 1 goto :pyfail
where python >nul 2>nul
if errorlevel 1 goto :pyfail
exit /b 0
:pyfail
echo [X] Python 可攜版安裝失敗(多半是網路問題)。重跑一次;或手動安裝後重跑:
echo       https://www.python.org/downloads/  (安裝時勾選 Add python.exe to PATH)
exit /b 1

:node
where node >nul 2>nul
if not errorlevel 1 exit /b 0
echo       這台電腦沒有 Node.js,下載官方可攜版(約 30 MB,只放進專案資料夾)...
if exist "%TOOLS%\node" rd /s /q "%TOOLS%\node"
if exist "%TOOLS%\node-v22.14.0-win-x64" rd /s /q "%TOOLS%\node-v22.14.0-win-x64"
curl -L --fail -o "%TOOLS%\node.zip" "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip"
if errorlevel 1 goto :nodefail
tar -xf "%TOOLS%\node.zip" -C "%TOOLS%"
if errorlevel 1 goto :nodefail
del /f /q "%TOOLS%\node.zip"
ren "%TOOLS%\node-v22.14.0-win-x64" node
where node >nul 2>nul
if errorlevel 1 goto :nodefail
exit /b 0
:nodefail
echo [X] Node.js 可攜版安裝失敗(多半是網路問題)。重跑一次;或手動裝 LTS 版後重跑:
echo       https://nodejs.org/
exit /b 1

:go
where go >nul 2>nul
if not errorlevel 1 exit /b 0
rem 排程器的 go.mod 要求 Go 1.26;系統若已裝 1.21+ 會自動抓對應工具鏈,不用理這裡
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
echo [X] Go 可攜版安裝失敗(多半是網路問題)。重跑一次;或手動安裝後重跑:
echo       https://go.dev/dl/
exit /b 1
