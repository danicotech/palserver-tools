#!/usr/bin/env bash
# 更新 Palworld 伺服器(先 ./stop.sh)。
set -e
cd "$(dirname "$0")"
steamcmd/steamcmd.sh +force_install_dir "$(pwd)/../server" +login anonymous +app_update 2394010 validate +quit
echo "更新完成!./start.sh 重新啟動。"
