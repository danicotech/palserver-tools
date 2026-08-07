#!/usr/bin/env bash
# Palworld SteamCMD 版:一次裝好「跑起完整服務」需要的全部東西(不需要 Docker)。
#   SteamCMD → 遊戲伺服器 → Python(存檔解析)→ Node(建網站)→ Go(排程器)
#   → 建置查詢網站 → 編譯排程器 → 產生設定檔
# 乾淨機器也不用先裝任何東西:缺 curl/Python 用套件管理器補,
# Node/Go 發行版版本常太舊,改抓官方可攜版(見 get-tools.sh)。
# 裝完直接 bash linux/native/start-all.sh 就有完整服務。重跑本檔可續傳/補裝。
set -e
cd "$(dirname "$0")/../.."
ROOT="$PWD"
NATIVE="$ROOT/linux/native"
. "$NATIVE/ui.sh"
. "$NATIVE/use-tools.sh"

# 伺服器安裝位置:預設 linux/native/server;舊版裝在 linux/server,沿用以免重下 6 GB
SRVDIR="$NATIVE/server"
[ -x "$ROOT/linux/server/PalServer.sh" ] && SRVDIR="$ROOT/linux/server"
# start-all 會記住使用者選的伺服器資料夾。那裡若已經有伺服器,就是他自己的安裝
# (常常在另一顆磁碟),直接沿用並略過 6 GB 下載,不要再複製一份。
# 也刻意不對它跑 steamcmd:validate 會覆蓋檔案,對跑了好幾個月的伺服器太危險,
# 要更新那台請用 update.sh。
PICKED=$(head -1 "$ROOT/backend/data/server-dir.txt" 2>/dev/null || true)
[ -n "${PICKED:-}" ] && [ -x "$PICKED/PalServer.sh" ] && SRVDIR="$PICKED"

# root 直接跑;非 root 有 sudo 用 sudo(裝系統套件用;可攜版不需要權限)
SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

PKG=""
for m in apt-get dnf pacman zypper apk; do
  command -v "$m" >/dev/null 2>&1 && PKG="$m" && break
done
sysinstall() { # sysinstall <apt> <dnf> <pacman>
  case "$PKG" in
    apt-get) $SUDO apt-get update -qq >/dev/null 2>&1 || true
             DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq $1 ;;
    dnf)     $SUDO dnf install -y -q $2 ;;
    pacman)  $SUDO pacman -Sy --noconfirm --quiet $3 ;;
    zypper)  $SUDO zypper -nq install $2 ;;
    apk)     $SUDO apk add --no-cache -q $1 ;;
    *)       echo "認不出套件管理器,請手動安裝:$1"; return 1 ;;
  esac
}

banner "Palworld 伺服器全家桶 · SteamCMD 版一鍵安裝" \
       "遊戲伺服器 + 排程開關服 + 存檔解析 + 查詢網站(不需要 Docker)"

# SKIP_STEAM=1:跳過 SteamCMD 與伺服器下載(測試、或已自備伺服器時用)
if [ "${SKIP_STEAM:-0}" != "1" ]; then

step "[1/7]" "SteamCMD..."
command -v curl >/dev/null 2>&1 || sysinstall "curl ca-certificates" "curl ca-certificates" curl
# SteamCMD 是 32 位元程式,乾淨的 64 位元系統一定缺 32 位元函式庫 —— 先補,
# 不然它會無聲地掛掉或報 "no such file or directory"(明明檔案就在)。
if ! [ -e /lib/ld-linux.so.2 ] && ! [ -e /lib32/ld-linux.so.2 ]; then
  echo "      安裝 SteamCMD 需要的 32 位元函式庫..."
  case "$PKG" in
    apt-get) $SUDO dpkg --add-architecture i386 >/dev/null 2>&1 || true
             sysinstall "lib32gcc-s1 lib32stdc++6" "" "" || warn "32 位元函式庫安裝失敗,SteamCMD 可能跑不動" ;;
    dnf)     sysinstall "" "glibc.i686 libstdc++.i686" "" || warn "32 位元函式庫安裝失敗" ;;
    pacman)  warn "Arch 需啟用 multilib 後安裝 lib32-gcc-libs(/etc/pacman.conf)" ;;
    apk)     err "Alpine(musl)跑不動 SteamCMD,請改用 Docker 版或 glibc 發行版"; exit 1 ;;
  esac
fi
if [ ! -x "$NATIVE/steamcmd/steamcmd.sh" ]; then
  mkdir -p "$NATIVE/steamcmd"
  curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar zx -C "$NATIVE/steamcmd"
  ok "已下載"
else
  ok "已存在,略過"
fi

step "[2/7]" "Palworld 專用伺服器(第一次約需下載數 GB,請耐心等)..."
if [ -n "${PICKED:-}" ] && [ -x "$PICKED/PalServer.sh" ]; then
  ok "使用你指定的伺服器,略過下載:$PICKED"
else
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
  err "伺服器安裝失敗。常見原因:磁碟空間不足(需 10 GB 以上)、網路中斷、"
  err "或 32 位元函式庫沒裝成。重跑本檔會續傳,不會重下已完成的部分。"
  exit 1
}
ok
fi

fi # SKIP_STEAM

step "[3/7]" "Python(解析存檔,查詢網站的玩家/帕魯資料靠它)..."
bash "$NATIVE/get-tools.sh" python
python3 -c "import ooz, palworld_save_tools" >/dev/null 2>&1 || {
  echo "      安裝解析套件..."
  python3 -m pip install --quiet --disable-pip-version-check -r backend/tools/palsave/requirements.txt 2>/dev/null ||
    python3 -m pip install --quiet --break-system-packages -r backend/tools/palsave/requirements.txt
}
python3 -c "import ooz, palworld_save_tools" >/dev/null 2>&1 || { err "解析套件安裝失敗"; exit 1; }
ok

step "[4/7]" "Node.js(建置查詢網站)..."
bash "$NATIVE/get-tools.sh" node
hash -r
# corepack 會照 package.json 的 packageManager 抓指定版本的 pnpm;抓不到就退回全域安裝。
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_ENABLE_STRICT=0
# 關鍵:pnpm 會照 packageManager 自我切換版本,下載不到就整個失敗
export npm_config_manage_package_manager_versions=false
corepack enable 2>/dev/null || true
(cd frontend && corepack prepare --activate >/dev/null 2>&1) || true
pnpm --version >/dev/null 2>&1 || {
  echo "      corepack 取不到指定版本的 pnpm,改用 npm 全域安裝..."
  npm i -g pnpm >/dev/null 2>&1 || $SUDO npm i -g pnpm
}
pnpm --version >/dev/null 2>&1 || { err "裝不起 pnpm,請手動 npm i -g pnpm 後重跑"; exit 1; }
ok "pnpm $(pnpm --version)"

step "[5/7]" "Go(編譯排程器)..."
bash "$NATIVE/get-tools.sh" go
hash -r
command -v go >/dev/null 2>&1 || { err "Go 安裝失敗,請自行安裝 https://go.dev/dl/ 後重跑"; exit 1; }
ok

step "[6/7]" "建置查詢網站與排程器(第一次比較久)..."
[ -f frontend/packages/web/dist/index.html ] || (cd frontend && pnpm install --no-frozen-lockfile && pnpm build)
[ -f frontend/packages/web/dist/index.html ] || { err "網站建置失敗"; exit 1; }
[ -x backend/palscheduler ] || (cd backend && go build -o palscheduler ./cmd/scheduler)
[ -x backend/palscheduler ] || { err "排程器編譯失敗"; exit 1; }
ok

step "[7/7]" "設定檔(預設密碼:管理 654321、進服 123456)..."
[ -f backend/config.json ] || bash linux/setup.sh
mkdir -p backend/data
ok

echo
banner "全部裝好了!" ""
echo "  接著執行: ${C_KEY}bash linux/native/start-all.sh${C_RESET}"
echo "  會一次帶起 遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站"
echo "  網站: ${C_KEY}http://localhost:9000${C_RESET}    遊戲: ${C_KEY}你的IP:8211${C_RESET}"
echo "${C_LINE}════════════════════════════════════════════════════════${C_RESET}"
