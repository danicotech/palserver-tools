#!/usr/bin/env bash
# 一次帶起「遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站」,完全不需要 Docker。
#   palsave   : Python 解析存檔(玩家/帕魯/公會資料的唯一來源)
#   scheduler : Go 排程器,同時提供 http://localhost:9000 的查詢網站與 API
#   PalServer : 由排程器依 backend/config.json 的時段表自動開關
set -e
cd "$(dirname "$0")/../.."
ROOT="$PWD"
# 配色與可攜版工具 PATH(install.sh 下載的 Node/Go;沒有就沒影響)
. "$ROOT/linux/native/ui.sh"
. "$ROOT/linux/native/use-tools.sh"

# 要用哪個伺服器資料夾。第一次會問,之後記住 —— 所以早就裝在別處的 SteamCMD
# 伺服器可以原地繼續用,不必搬任何檔案。要換資料夾就在它的提問輸入 C。
bash "$ROOT/linux/native/pick-server-dir.sh"
SERVER_DIR=$(head -1 "$ROOT/backend/data/server-dir.txt" 2>/dev/null || true)
[ -n "$SERVER_DIR" ] && [ -x "$SERVER_DIR/PalServer.sh" ] || {
  echo "[X] 沒有選好伺服器資料夾(或裡面沒有 PalServer.sh),不啟動。"
  echo "    重跑 bash linux/native/start-all.sh,在第一個問題選一個資料夾,"
  echo "    或選 M 自己輸入路徑;記錄放在 backend/data/server-dir.txt。"
  exit 1
}
export SERVER_DIR
export PANEL_DIR="$ROOT/frontend/packages/web/dist"
export CONFIG_PATH="$ROOT/backend/config.json"
export PRESENCE_PATH="$ROOT/backend/data/presence.json"
export ROSTER_PATH="$ROOT/backend/data/roster.json"
export PALS_CACHE_PATH="$ROOT/backend/data/pals-cache.json"
# Docker 版的預設位址是 compose 內網名稱,本機直跑要指回 127.0.0.1
export PALSAVE_URL="http://127.0.0.1:8213"
export REST_HOST="127.0.0.1"
export RCON_HOST="127.0.0.1"

step "[1/5]" "檢查伺服器本體..."
echo "      使用的伺服器資料夾:$SERVER_DIR"

step "[2/5]" "檢查 Python(存檔解析用)..."
command -v python3 >/dev/null || {
  err "找不到 python3。執行 bash linux/native/install.sh 會自動補齊(已裝好的部分會略過)。"
  exit 1
}
python3 -c "import ooz, palworld_save_tools" >/dev/null 2>&1 || {
  echo "    安裝解析套件(只有第一次需要)..."
  python3 -m pip install --quiet --disable-pip-version-check -r backend/tools/palsave/requirements.txt ||
    python3 -m pip install --quiet --break-system-packages -r backend/tools/palsave/requirements.txt
}

step "[3/5]" "檢查查詢網站(dist)..."
if [ ! -f "$PANEL_DIR/index.html" ]; then
  command -v pnpm >/dev/null || {
    err "查詢網站尚未建置,而且找不到 pnpm。"
    err "執行 bash linux/native/install.sh 會自動下載 Node 可攜版並建置網站。"
    exit 1
  }
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_ENABLE_STRICT=0
  # 關鍵:pnpm 會照 packageManager 自我切換版本,下載不到就整個失敗
  export npm_config_manage_package_manager_versions=false
  echo "    第一次要先建置網站(需要幾分鐘)..."
  (cd frontend && pnpm install --no-frozen-lockfile && pnpm build)
fi

step "[4/5]" "檢查排程器執行檔..."
if [ ! -x backend/palscheduler ]; then
  command -v go >/dev/null || {
    err "找不到排程器執行檔,也沒有 Go 可以編譯。"
    err "執行 bash linux/native/install.sh 會自動下載 Go 可攜版並編譯。"
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

# 官方 DefaultPalWorldSettings.ini 預設 RESTAPIEnabled=False、RCONEnabled=False,
# 照抄過去的話排程器完全沒辦法跟伺服器講話(廣播/踢人/關機/在線人數全部失敗)。
# 這裡在啟動前補開,順便把空的密碼填上 —— 使用者自己改過的值不會被動到。
ADMINPW=""; JOINPW=""
if [ -f .env ]; then
  ADMINPW=$(sed -n 's/^ADMIN_PASSWORD=//p' .env | head -1)
  JOINPW=$(sed -n 's/^SERVER_PASSWORD=//p' .env | head -1)
fi
python3 backend/tools/ensure_server_ini.py "$SERVER_DIR" "$ADMINPW" "$JOINPW" || true

step "[5/5]" "啟動存檔解析與排程器..."
mkdir -p backend/data/logs
( cd backend/tools/palsave && SAVE_ROOT="$SERVER_DIR" PORT=8213 \
    nohup python3 server.py >"$ROOT/backend/data/logs/palsave.log" 2>&1 & echo $! >"$ROOT/backend/data/palsave.pid" )
sleep 2
( cd backend && nohup ./palscheduler serve >"$ROOT/backend/data/logs/scheduler.log" 2>&1 & echo $! >"$ROOT/backend/data/scheduler.pid" )
sleep 3

# 確認真的起來了 —— 埠被佔用(例如 Docker 版正在跑)時排程器會直接結束
ok=0
for _ in $(seq 1 10); do
  if curl -fsS -m 2 http://127.0.0.1:9000/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo
  echo "[X] 服務沒有起來(http://localhost:9000 沒有回應)。最常見的原因:"
  echo "    1. Docker 版正在跑,佔住了同一個埠 —— 先 bash linux/stop.sh 停掉 Docker 版"
  echo "    2. 排程器啟動失敗 —— 看 backend/data/logs/scheduler.log"
  echo "    3. 存檔解析沒起來 —— 看 backend/data/logs/palsave.log"
  exit 1
fi

echo
echo "完成!(遊戲伺服器由排程器依時段表自動開關)"
echo "  查詢網站:http://localhost:9000"
echo "  遊戲連線:你的IP:8211"
echo "  日誌:backend/data/logs/"
echo
echo "要全部關掉:bash linux/native/stop-all.sh"
