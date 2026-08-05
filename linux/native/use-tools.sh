#!/usr/bin/env bash
# 把專案內建的可攜版工具(linux/native/tools/)排進 PATH 最前面(用 source 載入)。
# get-tools.sh 在發行版套件太舊或缺套件時,會把官方可攜版下載到這裡。
# 排最前面有兩個理由:1) 剛下載完當場就找得到 2) 版本固定,不受發行版影響。
# 目錄還不存在也無妨,PATH 多幾個不存在的路徑沒有副作用。
_NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$_NATIVE_DIR/tools/node/bin:$_NATIVE_DIR/tools/go/bin:$PATH"
unset _NATIVE_DIR
