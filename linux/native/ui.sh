#!/usr/bin/env bash
# 終端機配色與畫面(各腳本共用,用 source 載入)。
# 輸出不是終端機時(導到檔案/管線)自動關閉顏色,免得日誌裡塞滿逃逸碼。
if [ -t 1 ]; then
  C_TITLE=$'\033[1;97m'   # 亮白:標題
  C_LINE=$'\033[96m'      # 青:框線/裝飾
  C_STEP=$'\033[1;96m'    # 亮青:步驟編號
  C_OK=$'\033[92m'        # 綠:成功
  C_WARN=$'\033[93m'      # 黃:警告
  C_ERR=$'\033[1;91m'     # 亮紅:錯誤
  C_KEY=$'\033[1;93m'     # 亮黃:密碼/網址等重點
  C_DIM=$'\033[90m'       # 灰:次要說明
  C_RESET=$'\033[0m'
else
  C_TITLE="" C_LINE="" C_STEP="" C_OK="" C_WARN="" C_ERR="" C_KEY="" C_DIM="" C_RESET=""
fi

# banner "標題" "副標(可省略)"
# 左邊是創作者的線條狗頭(狗仔狗仔 出品),右邊放標題 ——
# 這是 CLI 工具的老傳統(neofetch、各家安裝器都這樣):吉祥物在左、資訊在右。
# 狗頭刻意只用純 ASCII:中文字寬在各終端機算法不一,混進圖裡一定歪;
# 也不畫右側框線,理由相同。
banner() {
  echo "${C_LINE}════════════════════════════════════════════════════════${C_RESET}"
  echo "${C_KEY}"'     / \__'"${C_RESET}"
  echo "${C_KEY}"'    (    @\____'"${C_RESET}    ${C_TITLE}狗仔狗仔 出品${C_RESET}"
  echo "${C_KEY}"'    /         O'"${C_RESET}    ${C_LINE}────────────────────────${C_RESET}"
  echo "${C_KEY}"'   /   (_____/'"${C_RESET}"
  echo "${C_KEY}"'  /_____/   U'"${C_RESET}"
  echo "  ${C_TITLE}$1${C_RESET}"
  [ -n "${2:-}" ] && echo "  ${C_DIM}$2${C_RESET}"
  echo "${C_LINE}════════════════════════════════════════════════════════${C_RESET}"
}

step() { echo; echo "${C_STEP}$1${C_RESET} $2"; }          # step "[1/7]" "SteamCMD..."
ok()   { echo "      ${C_OK}✔ ${1:-完成}${C_RESET}"; }
warn() { echo "      ${C_WARN}⚠ $1${C_RESET}"; }
err()  { echo "${C_ERR}[X] $1${C_RESET}"; }
