#!/usr/bin/env bash
# 停止全部服務(遊戲會先存檔再關閉)。
cd "$(dirname "$0")/.."
docker compose stop
echo "已全部停止。要再開請執行 ./start.sh"
