#!/usr/bin/env bash
# 問「要用哪個帕魯伺服器資料夾」,並把答案記下來。
#
# 為什麼需要:start-all 以前寫死用專案內建的伺服器資料夾,所以早就在別的地方
# (另一顆磁碟、舊的安裝、已經跑了好幾個月的伺服器)跑 SteamCMD 的人,除了把
# 整包 6 GB 搬過來之外沒別的辦法。這支只「記住路徑」,不搬、不複製任何檔案。
#
# 答案寫進 backend/data/server-dir.txt,start-all 讀出來後設定:
#   SERVER_DIR : 排程器要開關的那台伺服器
#   SAVE_ROOT  : 面板要讀誰的存檔
# 兩個指向同一個資料夾 —— SteamCMD 的安裝本來就是 PalServer.sh 和 Pal/Saved 並排。
#
# 只問一次:答案可以是選單編號,也可以直接貼路徑。多一個提問就多一段
# 沒辦法自動測試的互動(Windows 版那邊的 set /p 尤其麻煩),不值得。
set -u
cd "$(dirname "$0")/../.."
ROOT="$PWD"
. "$ROOT/linux/native/ui.sh"

STORE="$ROOT/backend/data/server-dir.txt"
mkdir -p "$ROOT/backend/data"

# describe <dir> —— 印出一句話說明,回傳碼代表能不能用:
#   0 可用   1 資料夾不存在   2 資料夾在但沒有 PalServer.sh
describe() {
  local d="$1" n=0 s
  [ -n "$d" ] && [ -d "$d" ] || return 1
  [ -f "$d/PalServer.sh" ] || return 2
  if [ -d "$d/Pal/Saved/SaveGames/0" ]; then
    for s in "$d"/Pal/Saved/SaveGames/0/*/Level.sav; do [ -f "$s" ] && n=$((n + 1)); done
  fi
  if [ "$n" = 0 ]; then
    echo "有伺服器本體 · 還沒有存檔(第一次開服後才會產生)"
  else
    echo "有伺服器本體 · $n 個世界存檔"
  fi
  return 0
}

# resolve <path> —— 找出真正放著 PalServer.sh 的那一層。
# 使用者手上有什麼就貼什麼:安裝資料夾本身、裡面深處的某個存檔、或它的上一層。
# 往上走再往下走,三種都收斂成同一個答案,不必把人擋回去叫他自己找。
# 上下都命中時以「往上」為準:貼在安裝裡面,遠比貼在另一個安裝之上常見。
resolve() {
  local p="$1" n=0 d
  [ -n "$p" ] || return 1
  # 貼到檔案(最常見的是 Level.sav)就從它所在的資料夾開始往上找
  [ -f "$p" ] && p=$(dirname "$p")
  while [ -n "$p" ] && [ "$p" != "/" ] && [ "$n" -lt 8 ]; do
    if [ -f "$p/PalServer.sh" ]; then printf '%s\n' "$p"; return 0; fi
    p=$(dirname "$p")
    n=$((n + 1))
  done
  # 往下最多三層:夠涵蓋 /opt/steamcmd -> steamapps/common/PalServer,
  # 又不會變成整顆磁碟的遞迴搜尋而卡住好幾分鐘。
  [ -d "$1" ] || return 1
  d=$(find "$1" -maxdepth 3 -name PalServer.sh -type f -print -quit 2>/dev/null)
  [ -n "$d" ] || return 1
  printf '%s\n' "$(dirname "$d")"
}

# 列出每個世界的名稱與最後存檔時間 —— 讓人認得出是不是自己的世界,而不是只看到數字。
worlds_of() {
  local d="$1" s
  for s in "$d"/Pal/Saved/SaveGames/0/*/Level.sav; do
    [ -f "$s" ] || continue
    printf '      - %s  最後存檔 %s\n' "$(basename "$(dirname "$s")")" \
      "$(date -r "$s" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')"
  done
}

# auto_detect —— 自動模式只認這個安裝推得出來的兩個位置:
#   1. 這個專案自己下載的伺服器
#   2. 專案所在的上一層(面板常常就放在伺服器資料夾裡面)
# 刻意不去掃各個磁碟猜別人的 Steam 版面:猜出來的路徑印在畫面上會被當成
# 「我們找到了這個」,比老實問一句還糟。找不到就走手動。
auto_detect() {
  local d
  for d in "$ROOT/linux/native/server" "$ROOT/linux/server" "$(dirname "$ROOT")"; do
    if describe "$d" >/dev/null 2>&1; then (cd "$d" && pwd); return 0; fi
  done
  return 1
}

CUR=""
[ -f "$STORE" ] && CUR=$(head -1 "$STORE")

# 記住的資料夾要先確認還在。磁碟沒掛上、資料夾被改名都會讓它失效,
# 拿一條不存在的路徑去開服,比重問一次糟糕得多。
if [ -n "$CUR" ]; then
  if desc=$(describe "$CUR"); then
    echo
    echo "  ${C_STEP}目前使用的伺服器資料夾${C_RESET}"
    echo "    ${C_KEY}$CUR${C_RESET}"
    echo "    $desc"
    echo
    printf "  按 Enter 直接用這個,或輸入 C 換一個: "
    read -r sel || sel=""
    case "$sel" in C | c) CUR="" ;; esac
  else
    echo
    warn "上次記住的資料夾現在讀不到了:$CUR"
    echo "      (磁碟沒掛上、資料夾被搬走或改名都會這樣)"
    CUR=""
  fi
fi

if [ -z "$CUR" ]; then
  echo
  echo "  ${C_STEP}要用哪個帕魯伺服器資料夾?${C_RESET}"
  echo "    就是放著 PalServer.sh 和 Pal/Saved 的那一層。"
  echo "    選好之後,排程器會直接開關那台伺服器、面板也讀它的存檔 —— 不會搬動任何檔案。"
  echo
  AUTO=$(auto_detect || true)
  if [ -n "$AUTO" ]; then
    echo "    ${C_KEY}[A]${C_RESET} 自動偵測到的"
    echo "        ${C_KEY}$AUTO${C_RESET}"
    echo "        $(describe "$AUTO")"
    echo "    ${C_KEY}[M]${C_RESET} 我自己輸入路徑"
  else
    warn "自動偵測沒有找到伺服器(這台還沒裝過,或裝在別的地方)。"
  fi

  while [ -z "$CUR" ]; do
    echo
    if [ -n "$AUTO" ]; then
      printf "  按 Enter 用自動偵測的,輸入 M 自己填,或直接貼上路徑: "
      read -r sel || sel=""
      [ -n "$sel" ] || sel=A
      case "$sel" in A | a) CUR="$AUTO"; continue ;; esac
    else
      sel=M
    fi
    case "$sel" in
      M | m)
        echo
        echo "    請輸入伺服器安裝資料夾的完整路徑。"
        echo "    貼到裡面幾層(甚至貼到 Level.sav)也沒關係,會自動往上對正。"
        printf "  路徑: "
        read -r sel || sel=""
        [ -n "$sel" ] || { err "沒有輸入任何路徑。"; continue; }
        ;;
    esac
    # 貼進來常帶引號或結尾斜線,先清乾淨
    sel="${sel%\"}"; sel="${sel#\"}"; sel="${sel%\'}"; sel="${sel#\'}"
    [ "$sel" != "/" ] && sel="${sel%/}"
    if found=$(resolve "$sel"); then
      CUR=$(cd "$found" && pwd)
      [ "$CUR" != "$sel" ] && warn "你輸入的不是伺服器那一層,已自動對正到:$CUR"
    elif [ ! -e "$sel" ]; then
      err "這個路徑不存在:$sel"
    else
      err "這條路徑上下都找不到 PalServer.sh:$sel"
      echo "      已經檢查過:這個資料夾本身、往上每一層、以及往下三層。"
      echo "      請指到伺服器安裝的那一層 —— 裡面看得到 PalServer.sh 和 Pal 資料夾。"
      echo "      還沒安裝過伺服器的話,先跑 bash linux/native/install.sh。"
    fi
  done
fi

# 採用之前先把查到的東西講清楚。一條「看起來對」的路徑最浪費時間:
# 伺服器起來了、面板卻是空的,而且看不出是哪一邊指到別的地方去。
printf '%s\n' "$CUR" >"$STORE"
echo
echo "  ${C_STEP}檢查結果${C_RESET}"
echo "    資料夾        ${C_OK}OK${C_RESET}  $CUR"
echo "    PalServer.sh  ${C_OK}OK${C_RESET}"
if [ -d "$CUR/Pal/Saved/SaveGames" ]; then
  echo "    存檔資料夾    ${C_OK}OK${C_RESET}  $(describe "$CUR")"
  worlds_of "$CUR"
else
  echo "    存檔資料夾    ${C_WARN}尚未產生${C_RESET}  第一次開服後才會出現,這是正常的"
fi
echo
ok "就用這個資料夾啟動,不會搬動裡面任何檔案。"
echo "      記在 backend/data/server-dir.txt,下次直接沿用;要換就在提問時輸入 C。"
