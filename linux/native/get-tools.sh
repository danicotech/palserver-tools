#!/usr/bin/env bash
# 確保 Python / Node / Go 可用:系統夠新就直接用;不夠就補救 ——
#   Python:發行版幾乎都有,用套件管理器裝(缺 pip 也一併補)
#   Node / Go:發行版套件庫常常太舊(Debian 12 的 Go 是 1.19、Ubuntu 22.04 的
#   Node 是 12,而排程器要 Go 1.26、前端要 Node 20+),直接下載官方可攜版
#   到 linux/native/tools/ —— 版本鎖定、不動系統、免管理員也能裝。
# 用法:get-tools.sh python|node|go
set -e
NATIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$NATIVE/tools"
. "$NATIVE/ui.sh"
. "$NATIVE/use-tools.sh"

NODE_VER="v22.14.0"
GO_VER="1.26.1"

# root 直接跑;非 root 有 sudo 就用 sudo;都沒有 → 系統套件裝不了,
# 但可攜版下載完全不受影響(它只寫專案資料夾)。
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

PKG=""
for m in apt-get dnf pacman zypper apk; do
  command -v "$m" >/dev/null 2>&1 && PKG="$m" && break
done

sysinstall() { # sysinstall <apt 套件...> ; <dnf 套件...> ; <pacman 套件...>
  case "$PKG" in
    apt-get) $SUDO apt-get update -qq >/dev/null 2>&1 || true
             DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq $1 ;;
    dnf)     $SUDO dnf install -y -q $2 ;;
    pacman)  $SUDO pacman -Sy --noconfirm --quiet $3 ;;
    zypper)  $SUDO zypper -nq install $2 ;;
    apk)     $SUDO apk add --no-cache -q $1 ;;
    *)       return 1 ;;
  esac
}

# 乾淨環境(尤其容器)連 curl / tar / 憑證都沒有,先補齊
ensure_basics() {
  command -v curl >/dev/null 2>&1 || sysinstall "curl ca-certificates" "curl ca-certificates" curl || true
  command -v tar  >/dev/null 2>&1 || sysinstall tar tar tar || true
  command -v curl >/dev/null 2>&1 || { err "沒有 curl 也裝不了(沒有權限?)。請先安裝 curl 後重跑。"; exit 1; }
}

# Palworld 伺服器只有 x86_64 版;可攜版工具也只抓這個架構
arch_check() {
  case "$(uname -m)" in
    x86_64|amd64) return 0 ;;
    *) err "這台是 $(uname -m),Palworld 伺服器只有 x86_64 版,SteamCMD 模式跑不起來。"
       err "ARM 機器請改用有模擬層的環境,或把面板指向別台 x86_64 伺服器。"
       return 1 ;;
  esac
}

fetch() { # fetch <網址> <輸出檔>
  echo "      ${C_DIM}下載 $1${C_RESET}"
  curl -fL --progress-bar -o "$2" "$1"
}

case "${1:-}" in
python)
  ensure_basics
  command -v python3 >/dev/null 2>&1 || sysinstall python3 python3 python || true
  command -v python3 >/dev/null 2>&1 || { err "裝不了 python3,請手動安裝後重跑。"; exit 1; }
  # pip:某些發行版拆成獨立套件;venv 模組缺的話 ensurepip 也會失敗,逐招試
  python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --upgrade >/dev/null 2>&1 || \
    sysinstall python3-pip python3-pip python-pip || true
  python3 -m pip --version >/dev/null 2>&1 || { err "裝不了 pip(python3-pip)。"; exit 1; }
  ok "Python $(python3 -V 2>&1 | awk '{print $2}')"
  ;;

node)
  ensure_basics
  NEED=1
  if command -v node >/dev/null 2>&1; then
    MAJOR="$(node -v | sed 's/^v//;s/\..*//')"
    if [ "${MAJOR:-0}" -ge 20 ] 2>/dev/null; then NEED=0; else
      warn "系統的 Node 是 $(node -v),前端建置需要 20+,改用可攜版(不動系統的)"
    fi
  fi
  if [ "$NEED" = 1 ]; then
    arch_check || exit 1
    echo "      這台沒有(夠新的)Node.js,下載官方可攜版(約 30 MB,只放進專案資料夾)..."
    rm -rf "$TOOLS/node" "$TOOLS/node-$NODE_VER-linux-x64"
    mkdir -p "$TOOLS"
    fetch "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.gz" "$TOOLS/node.tgz"
    tar -xzf "$TOOLS/node.tgz" -C "$TOOLS"
    rm -f "$TOOLS/node.tgz"
    mv "$TOOLS/node-$NODE_VER-linux-x64" "$TOOLS/node"
    hash -r
  fi
  command -v node >/dev/null 2>&1 || { err "Node 安裝失敗。"; exit 1; }
  ok "Node $(node -v)"
  ;;

go)
  ensure_basics
  NEED=1
  if command -v go >/dev/null 2>&1; then
    GV="$(go env GOVERSION 2>/dev/null | sed 's/^go//')"
    # 1.21 之後的 Go 會照 go.mod 自動抓對應工具鏈,舊版沿用即可
    case "$GV" in
      1.2[1-9]*|1.[3-9]*|[2-9].*) NEED=0 ;;
      *) warn "系統的 Go 是 ${GV:-未知},太舊(要 1.21+ 才會自動抓新工具鏈),改用可攜版" ;;
    esac
  fi
  if [ "$NEED" = 1 ]; then
    arch_check || exit 1
    echo "      這台沒有(夠新的)Go,下載官方可攜版(約 80 MB,只放進專案資料夾)..."
    rm -rf "$TOOLS/go"
    mkdir -p "$TOOLS"
    fetch "https://go.dev/dl/go$GO_VER.linux-amd64.tar.gz" "$TOOLS/go.tgz"
    tar -xzf "$TOOLS/go.tgz" -C "$TOOLS"
    rm -f "$TOOLS/go.tgz"
    hash -r
  fi
  command -v go >/dev/null 2>&1 || { err "Go 安裝失敗。"; exit 1; }
  ok "$(go version | awk '{print $3}')"
  ;;

*)
  err "用法:get-tools.sh python|node|go"
  exit 1
  ;;
esac
