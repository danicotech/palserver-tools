#!/usr/bin/env bash
# 一鍵啟動(Linux/macOS)。
#   有 Docker  → Docker 版:四個容器(遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站)
#   沒有 Docker → 自動改用 SteamCMD 版:同樣四項服務,只是不透過容器
set -e
cd "$(dirname "$0")/.."
. linux/native/ui.sh
banner "Palworld 伺服器全家桶 · 一鍵啟動"        "有 Docker 走 Docker 版;沒有就自動改用 SteamCMD 版"

fallback_native() {
  echo
  echo "→ 改用不需要 Docker 的 SteamCMD 版(遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站)"
  echo
  exec bash linux/native/start-all.sh
}

if ! command -v docker >/dev/null; then
  echo "這台機器沒有 docker。"
  echo "想用 Docker 版:https://docs.docker.com/engine/install/ 或 curl -fsSL https://get.docker.com | sh"
  fallback_native
fi

# 光有 docker 指令不代表守護程式在跑;沒跑的話 docker compose 會噴
# 「Cannot connect to the Docker daemon at unix:///var/run/docker.sock」這種訊息。
if ! docker info >/dev/null 2>&1; then
  echo "[!] Docker 引擎沒在跑,或你的帳號沒有權限存取它。"
  echo "    Linux:sudo systemctl start docker"
  echo "          權限問題:sudo usermod -aG docker \"\$USER\" 後重新登入(或先用 sudo 跑本腳本)"
  echo "    macOS:打開 Docker Desktop,等選單列鯨魚圖示不再轉動"
  fallback_native
fi

bash linux/setup.sh
echo "啟動所有服務(第一次要下載映像,可能需要幾分鐘)..."
docker compose up -d --build
echo "完成!查詢網站:http://localhost   遊戲連線:你的IP:8211"
