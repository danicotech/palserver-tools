#!/usr/bin/env bash
# Palworld 原生安裝(SteamCMD,Linux)。重跑可續傳/驗證。
set -e
cd "$(dirname "$0")"
command -v curl >/dev/null || { echo "[X] 需要 curl:sudo apt install -y curl"; exit 1; }
if [ ! -x steamcmd/steamcmd.sh ]; then
  echo "[1/3] 下載 SteamCMD..."
  mkdir -p steamcmd && cd steamcmd
  curl -sSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar zx
  cd ..
fi
echo "[2/3] 安裝/驗證 Palworld 專用伺服器(第一次約需下載數 GB)..."
echo "     (若失敗且訊息含 lib32gcc:sudo apt install -y lib32gcc-s1)"
steamcmd/steamcmd.sh +force_install_dir "$(pwd)/../server" +login anonymous +app_update 2394010 validate +quit
echo "[3/3] 完成!接著 ./start.sh 啟動伺服器。"
