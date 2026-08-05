@echo off
rem 把專案內建的可攜版工具(windows\native\tools\)排進 PATH 最前面。
rem install.bat 在電腦缺 Python/Node/Go 時會把官方可攜版下載到這裡。
rem 排最前面有兩個理由:
rem   1) 剛下載完、當場就找得到 —— 不用「關掉視窗重跑一次」
rem   2) 版本固定,不受系統上其他版本影響
rem 目錄還不存在也無妨,PATH 多幾個不存在的路徑沒有副作用。
rem 注意:這支不能 setlocal —— 要讓呼叫者拿到改完的 PATH。
set "PATH=%~dp0tools\python;%~dp0tools\python\Scripts;%~dp0tools\node;%~dp0tools\go\bin;%PATH%"
