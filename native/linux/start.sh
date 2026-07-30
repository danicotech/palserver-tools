#!/usr/bin/env bash
# 啟動 Palworld 伺服器(原生,背景執行;日誌 native/server/server.log)。
set -e
cd "$(dirname "$0")/../server"
[ -f PalServer.sh ] || { echo "[X] 尚未安裝,請先 ./install.sh"; exit 1; }
CFG="Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
if [ ! -f "$CFG" ]; then
  mkdir -p "$(dirname "$CFG")"
  cp DefaultPalWorldSettings.ini "$CFG"
  echo "已建立設定檔:$CFG(想改名稱/密碼/倍率就編輯它,改完重開)"
fi
nohup ./PalServer.sh -publicport=8211 -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS >server.log 2>&1 &
echo "伺服器已啟動(PID $!)。連線:你的IP:8211(UDP);停止請用 ./stop.sh"
