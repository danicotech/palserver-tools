#!/usr/bin/env bash
# 一鍵啟動(Linux/macOS):首次自動產生設定,然後啟動全部服務。
set -e
cd "$(dirname "$0")/.."

command -v docker >/dev/null || {
  echo "[X] 找不到 docker。安裝方式:https://docs.docker.com/engine/install/"
  echo "    或直接跑:curl -fsSL https://get.docker.com | sh"
  exit 1
}

# 光有 docker 指令不代表守護程式在跑;沒跑的話 docker compose 會噴
# 「Cannot connect to the Docker daemon at unix:///var/run/docker.sock」這種訊息。
if ! docker info >/dev/null 2>&1; then
  echo "[X] Docker 引擎沒在跑,或你的帳號沒有權限存取它。"
  echo "    Linux:sudo systemctl start docker"
  echo "          權限問題:sudo usermod -aG docker \"\$USER\" 後重新登入(或先用 sudo 跑本腳本)"
  echo "    macOS:打開 Docker Desktop,等選單列鯨魚圖示不再轉動"
  exit 1
fi

bash linux/setup.sh
echo "啟動所有服務(第一次要下載映像,可能需要幾分鐘)..."
docker compose up -d --build
echo "完成!查詢網站:http://localhost   遊戲連線:你的IP:8211"
