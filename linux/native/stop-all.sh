#!/usr/bin/env bash
# 停止 SteamCMD 版的全套服務(排程器 + 存檔解析 + 遊戲伺服器)。
cd "$(dirname "$0")/../.."
ROOT="$PWD"

kill_pidfile() {
  local f="$1" name="$2"
  [ -f "$f" ] || return 0
  local pid
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "已停止 $name (pid $pid)"
  fi
  rm -f "$f"
}

echo "正在停止排程器與存檔解析..."
kill_pidfile "$ROOT/backend/data/scheduler.pid" "排程器"
kill_pidfile "$ROOT/backend/data/palsave.pid" "存檔解析"

echo "正在停止遊戲伺服器(會先存檔)..."
pkill -TERM -x PalServer-Linux-Shipping 2>/dev/null || true
for _ in $(seq 1 20); do
  pgrep -x PalServer-Linux-Shipping >/dev/null || break
  sleep 1
done
pkill -KILL -x PalServer-Linux-Shipping 2>/dev/null || true

echo "已全部停止。要再開就執行:bash linux/native/start-all.sh"
