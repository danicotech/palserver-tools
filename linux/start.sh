#!/usr/bin/env bash
# 一鍵啟動(Linux/macOS):首次自動產生設定,然後啟動全部服務。
set -e
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "[X] 請先安裝 Docker:https://docs.docker.com/engine/install/"; exit 1; }
bash scripts/setup.sh
echo "啟動所有服務(第一次要下載映像,可能需要幾分鐘)..."
docker compose up -d --build
echo "完成!查詢網站:http://localhost   遊戲連線:你的IP:8211"
