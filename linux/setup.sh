#!/usr/bin/env bash
# 首次啟動自動設定(Linux/macOS):
#   沒有 .env / backend/config.json 時自動產生 —— 隨機密碼 + token,
#   並讓 config.json 的 rcon.password 與 .env 的 ADMIN_PASSWORD 保持一致。
# 已存在的檔案一律不動,重複執行安全。需要 python3(絕大多數系統內建)。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rand() { tr -dc 'a-zA-Z0-9' </dev/urandom | head -c "$1"; }

# ---- .env(所有伺服器參數都在這;從 .example.env 複製,並隨機生成兩組密碼)----
if [ ! -f "$ROOT/.env" ]; then
  # 兩組密碼用好記的固定預設值(自用/區網夠用;要開放外網請自行改 .env)
  sed -e "s/^ADMIN_PASSWORD=CHANGE_ME_ADMIN$/ADMIN_PASSWORD=654321/" \
      -e "s/^SERVER_PASSWORD=CHANGE_ME_JOIN$/SERVER_PASSWORD=123456/" \
      "$ROOT/.example.env" > "$ROOT/.env"
  echo "已從 .example.env 產生 .env(兩組密碼已隨機生成;所有伺服器參數都可在 .env 調整)"
fi

# 讀 .env
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2-)"
SERVER_PASSWORD="$(grep -E '^SERVER_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2-)"

# ---- backend/config.json ----
if [ ! -f "$ROOT/backend/config.json" ]; then
  TOKEN="$(rand 32)" ADMIN_PASSWORD="$ADMIN_PASSWORD" python3 - "$ROOT" <<'PY'
import json, os, sys
root = sys.argv[1]
cfg = json.load(open(f"{root}/backend/config.example.json", encoding="utf-8"))
cfg["rcon"]["password"] = os.environ["ADMIN_PASSWORD"]
cfg["api"]["token"] = os.environ["TOKEN"]
json.dump(cfg, open(f"{root}/backend/config.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  echo "已產生 backend/config.json(密碼已與 .env 同步、API token 已隨機生成)"
fi

echo ""
echo "================ 你的伺服器密碼(保存好!) ================"
echo "  管理密碼 ADMIN_PASSWORD : $ADMIN_PASSWORD"
echo "  進服密碼 SERVER_PASSWORD: $SERVER_PASSWORD"
echo "  (之後想改:編輯專案根目錄的 .env,再執行 ./restart.sh)"
echo "============================================================"
