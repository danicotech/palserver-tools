#!/usr/bin/env bash
# 一次帶起「遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站」,完全不需要 Docker。
#   palsave   : Python 解析存檔(玩家/帕魯/公會資料的唯一來源)
#   scheduler : Go 排程器,同時提供 http://localhost:9000 的查詢網站與 API
#   PalServer : 由排程器依 backend/config.json 的時段表自動開關
set -e
cd "$(dirname "$0")/../.."
ROOT="$PWD"

export SERVER_DIR="$ROOT/linux/native/server"
export PANEL_DIR="$ROOT/frontend/packages/web/dist"
export CONFIG_PATH="$ROOT/backend/config.json"
export PRESENCE_PATH="$ROOT/backend/data/presence.json"
export ROSTER_PATH="$ROOT/backend/data/roster.json"
# Docker 版的預設位址是 compose 內網名稱,本機直跑要指回 127.0.0.1
export PALSAVE_URL="http://127.0.0.1:8213"
export REST_HOST="127.0.0.1"
export RCON_HOST="127.0.0.1"

echo "[1/5] 檢查伺服器本體..."
[ -x "$SERVER_DIR/PalServer.sh" ] || {
  echo "[X] 還沒安裝伺服器本體,請先執行 bash linux/native/install.sh"
  exit 1
}

echo "[2/5] 檢查 Python(存檔解析用)..."
command -v python3 >/dev/null || {
  echo "[X] 找不到 python3。Debian/Ubuntu:sudo apt install -y python3 python3-pip"
  exit 1
}
python3 -c "import pyooz, palworld_save_tools" >/dev/null 2>&1 || {
  echo "    安裝解析套件(只有第一次需要)..."
  python3 -m pip install --quiet --disable-pip-version-check -r backend/tools/palsave/requirements.txt ||
    python3 -m pip install --quiet --break-system-packages -r backend/tools/palsave/requirements.txt
}

echo "[3/5] 檢查查詢網站(dist)..."
if [ ! -f "$PANEL_DIR/index.html" ]; then
  command -v pnpm >/dev/null || {
    echo "[X] 查詢網站尚未建置,而且找不到 pnpm。裝好 Node.js 後執行:"
    echo "      corepack enable && cd frontend && pnpm install && pnpm build"
    exit 1
  }
  echo "    第一次要先建置網站(需要幾分鐘)..."
  (cd frontend && pnpm install --no-frozen-lockfile && pnpm build)
fi

echo "[4/5] 檢查排程器執行檔..."
if [ ! -x backend/palscheduler ]; then
  command -v go >/dev/null || {
    echo "[X] 找不到排程器執行檔,也沒有 Go 可以編譯。裝 Go(https://go.dev/dl/)後重跑。"
    exit 1
  }
  echo "    編譯排程器(只有第一次需要)..."
  (cd backend && go build -o palscheduler ./cmd/scheduler)
fi

[ -f backend/config.json ] || {
  echo "[X] 找不到 backend/config.json,先跑一次:bash linux/setup.sh"
  exit 1
}
mkdir -p backend/data

echo "[5/5] 啟動存檔解析與排程器..."
mkdir -p backend/data/logs
( cd backend/tools/palsave && SAVE_ROOT="$SERVER_DIR" PORT=8213 \
    nohup python3 server.py >"$ROOT/backend/data/logs/palsave.log" 2>&1 & echo $! >"$ROOT/backend/data/palsave.pid" )
sleep 2
( cd backend && nohup ./palscheduler serve >"$ROOT/backend/data/logs/scheduler.log" 2>&1 & echo $! >"$ROOT/backend/data/scheduler.pid" )
sleep 3

echo
echo "完成!(遊戲伺服器由排程器依時段表自動開關)"
echo "  查詢網站:http://localhost:9000"
echo "  遊戲連線:你的IP:8211"
echo "  日誌:backend/data/logs/"
echo
echo "要全部關掉:bash linux/native/stop-all.sh"
