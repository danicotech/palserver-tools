#!/usr/bin/env bash
# 重啟服務:套用 .env / backend/config.json 的新設定。
set -e
cd "$(dirname "$0")/.."
docker compose up -d --build
echo "完成!網站:http://localhost"
