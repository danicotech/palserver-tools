@echo off
rem Prepend the bundled portable tools (windows\native\tools\) to PATH.
rem get-tools.bat downloads the official portable builds there when
rem Python/Node/Go are missing. Prepending wins for two reasons:
rem   1) a freshly downloaded tool is found immediately, so the user
rem      never has to close the window and run the script again;
rem   2) versions are pinned, unaffected by whatever else is installed.
rem Missing dirs are harmless. No setlocal: the caller needs this PATH.
set "PATH=%~dp0tools\python;%~dp0tools\python\Scripts;%~dp0tools\node;%~dp0tools\go\bin;%PATH%"
