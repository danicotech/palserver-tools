#!/usr/bin/env bash
# Palworld SteamCMD 版:一次裝好「跑起完整服務」需要的全部東西(不需要 Docker)。
#   SteamCMD → 遊戲伺服器 → Python(存檔解析)→ Node(建網站)→ Go(排程器)
#   → 建置查詢網站 → 編譯排程器 → 產生設定檔
# 裝完直接 bash linux/native/start-all.sh 就有完整服務。重跑本檔可續傳/補裝。
set -e
cd "$(dirname "$0")/../.."
ROOT="$PWD"
NATIVE="$ROOT/linux/native"
# 伺服器安裝位置:預設 linux/native/server;舊版裝在 linux/server,沿用以免重下 6 GB
SRVDIR="$NATIVE/server"
[ -x "$ROOT/linux/server/PalServer.sh" ] && SRVDIR="$ROOT/linux/server"

echo "============================================================"
echo "  Palworld SteamCMD 版:一次裝好(不需要 Docker)"
echo "  裝完執行 bash linux/native/start-all.sh 就能開服 + 開網站"
echo "============================================================"
echo

# 找得到哪個套件管理器,決定怎麼裝系統套件
PKG=""
for m in apt-get dnf pacman zypper apk; do
  command -v "$m" >/dev/null && PKG="$m" && break
done

sysinstall() { # sysinstall <apt 套件> <dnf 套件> <pacman 套件>
  case "$PKG" in
    apt-get) sudo apt-get update -qq && sudo apt-get install -y "$1" ;;
    dnf)     sudo dnf install -y "$2" ;;
    pacman)  sudo pacman -Sy --noconfirm "$3" ;;
    zypper)  sudo zypper install -y "$2" ;;
    apk)     sudo apk add --no-cache "$1" ;;
    *)       echo "[X] 認不出套件管理器,請手動安裝 $1 後重跑本檔"; return 1 ;;
  esac
}

echo "[1/7] SteamCMD..."
command -v curl >/dev/null || sysinstall curl curl curl
if [ ! -x "$NATIVE/steamcmd/steamcmd.sh" ]; then
  mkdir -p "$NATIVE/steamcmd"
  curl -sSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar zx -C "$NATIVE/steamcmd"
  echo "      已下載"
else
  echo "      已存在,略過"
fi

echo "[2/7] Palworld 專用伺服器(第一次約需下載數 GB,請耐心等)..."
echo "      (若失敗且訊息含 lib32gcc:sudo apt install -y lib32gcc-s1)"
# 「Missing configuration」的三個已知成因逐次換招:剛自我更新完、appcache 過期、參數順序。
SCMD="$NATIVE/steamcmd/steamcmd.sh"
echo "      嘗試 1/4:標準安裝"
"$SCMD" +force_install_dir "$SRVDIR" +login anonymous +app_update 2394010 validate +quit || true
if [ ! -x "$SRVDIR/PalServer.sh" ]; then
  echo "      嘗試 2/4:清掉 SteamCMD 快取後再試"
  rm -rf "$NATIVE/steamcmd/appcache"; sleep 2
  "$SCMD" +force_install_dir "$SRVDIR" +login anonymous +app_update 2394010 validate +quit || true
fi
if [ ! -x "$SRVDIR/PalServer.sh" ]; then
  echo "      嘗試 3/4:改用 login 在前的參數順序"
  "$SCMD" +login anonymous +force_install_dir "$SRVDIR" +app_update 2394010 validate +quit || true
fi
if [ ! -x "$SRVDIR/PalServer.sh" ]; then
  echo "      嘗試 4/4:先裝到預設位置再搬過去"
  "$SCMD" +login anonymous +app_update 2394010 validate +quit || true
  DEF="$NATIVE/steamcmd/steamapps/common/PalServer"
  [ -x "$DEF/PalServer.sh" ] && mkdir -p "$SRVDIR" && cp -a "$DEF/." "$SRVDIR/" && rm -rf "$DEF"
fi
[ -x "$SRVDIR/PalServer.sh" ] || {
  echo "[X] 伺服器安裝失敗。常見原因:磁碟空間不足(需 10 GB 以上)、網路中斷、"
  echo "    或缺 32 位元函式庫(sudo apt install -y lib32gcc-s1)。重跑本檔會續傳。"
  exit 1
}
echo "      完成"

echo "[3/7] Python(解析存檔,查詢網站的玩家/帕魯資料靠它)..."
command -v python3 >/dev/null || sysinstall python3 python3 python
command -v pip3 >/dev/null || python3 -m ensurepip --upgrade >/dev/null 2>&1 || sysinstall python3-pip python3-pip python-pip
python3 -c "import ooz, palworld_save_tools" >/dev/null 2>&1 || {
  echo "      安裝解析套件..."
  python3 -m pip install --quiet --disable-pip-version-check -r backend/tools/palsave/requirements.txt ||
    python3 -m pip install --quiet --break-system-packages -r backend/tools/palsave/requirements.txt
}
echo "      完成"

echo "[4/7] Node.js(建置查詢網站)..."
command -v node >/dev/null || sysinstall nodejs nodejs nodejs
command -v npm >/dev/null || sysinstall npm npm npm
# corepack 會照 package.json 的 packageManager 抓指定版本的 pnpm;抓不到就退回全域安裝。
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_ENABLE_STRICT=0
# 關鍵:pnpm 會照 packageManager 自我切換版本,下載不到就整個失敗
export npm_config_manage_package_manager_versions=false
corepack enable 2>/dev/null || true
(cd frontend && corepack prepare --activate >/dev/null 2>&1) || true
pnpm --version >/dev/null 2>&1 || {
  echo "      corepack 取不到指定版本的 pnpm,改用 npm 全域安裝..."
  sudo npm i -g pnpm || npm i -g pnpm
}
pnpm --version >/dev/null 2>&1 || { echo "[X] 裝不起 pnpm,請手動 npm i -g pnpm 後重跑"; exit 1; }
echo "      完成"

echo "[5/7] Go(編譯排程器)..."
command -v go >/dev/null || sysinstall golang-go golang go
command -v go >/dev/null || { echo "[X] Go 安裝失敗,請自行安裝 https://go.dev/dl/ 後重跑"; exit 1; }
echo "      完成"

echo "[6/7] 建置查詢網站與排程器(第一次比較久)..."
[ -f frontend/packages/web/dist/index.html ] || (cd frontend && pnpm install --no-frozen-lockfile && pnpm build)
[ -f frontend/packages/web/dist/index.html ] || { echo "[X] 網站建置失敗"; exit 1; }
[ -x backend/palscheduler ] || (cd backend && go build -o palscheduler ./cmd/scheduler)
[ -x backend/palscheduler ] || { echo "[X] 排程器編譯失敗"; exit 1; }
echo "      完成"

echo "[7/7] 設定檔(第一次會產生隨機密碼)..."
[ -f backend/config.json ] || bash linux/setup.sh
mkdir -p backend/data
echo "      完成"

echo
echo "============================================================"
echo "  全部裝好了!"
echo "  接著執行: bash linux/native/start-all.sh"
echo "  會一次帶起 遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站"
echo "  網站: http://localhost:9000    遊戲: 你的IP:8211"
echo "============================================================"
