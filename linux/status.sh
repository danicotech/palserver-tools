#!/usr/bin/env bash
# 查看服務狀態與排程器日誌。
cd "$(dirname "$0")"
echo "================= 服務狀態 ================="
docker compose ps
echo "============== 排程器最近日誌 =============="
docker compose logs --tail 20 scheduler
