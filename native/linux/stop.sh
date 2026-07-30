#!/usr/bin/env bash
# 停止 Palworld 伺服器(原生)。
pkill -f PalServer-Linux || true
echo "已停止。伺服器每 30 秒自動存檔,最多遺失最近 30 秒進度。"
