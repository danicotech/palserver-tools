#!/usr/bin/env bash
# 重啟服務:套用 .env / backend/config.json 的新設定。
set -e
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "[X] Docker 引擎沒在跑(或沒有權限)。Linux:sudo systemctl start docker;macOS:打開 Docker Desktop。"
  exit 1
fi

docker compose up -d --build
echo "完成!網站:http://localhost"
