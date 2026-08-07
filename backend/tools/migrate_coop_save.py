# -*- coding: utf-8 -*-
"""把單機 / 單機多人連線的存檔,完整搬到專用伺服器 —— 一支跑完全部。

社群的標準流程有五步,少做一步就會出現「看起來成功但其實不對」的狀況:

  1. 把世界資料夾放進 <伺服器>/Pal/Saved/SaveGames/0/
  2. GameUserSettings.ini 的 DedicatedServerName 改成該資料夾名稱
     -> 這步交給 ensure_world.py(start-all 啟動前會自動做)
  3. 移除 WorldOption.sav
     -> 它會蓋過伺服器的 PalWorldSettings.ini,留著的話你在 ini 調的
        經驗倍率、掉落率、難度全部無效,伺服器照單機當初的設定跑
  4. 先用同一個 Steam 帳號進伺服器一次,讓它發一個玩家槽給你(臨時角色)
     -> 那個 Player id 會出現在伺服器 log:
        [LOG] xxx joined the server. (User id: steam_xxx, Player id: 這一串)
  5. 把單機主機玩家(00000000-0000-0000-0000-000000000001)重新綁到那個 Player id
     -> 本檔的主要工作;細節與安全性見 fix_host_save.py 的說明

還有一個很多人事後才發現的:地圖探索(Fog of War)。臨時角色會寫一份空的
探索資料蓋掉原本的,所以要把本機備份裡的 LocalData 複製回來。

用法:
    python migrate_coop_save.py <世界資料夾> --server-uid <Player id> \\
        [--local-data <本機備份存檔資料夾>] [--yes]

範例:
    python migrate_coop_save.py "...\\SaveGames\\0\\1892DB69..." \\
        --server-uid 649518AF-0000-0000-0000-000000000000 \\
        --local-data "D:\\備份\\單機存檔\\1892DB69..."

一定會先把整個世界資料夾備份起來;每一步都會印出做了什麼,最後重新讀回來驗證。
"""
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fix_host_save import (ANCHOR, DEFAULT_OLD, decompress_save, guid_bytes,  # noqa: E402
                           patch, patch_player_file, rewrite, save_type_of)

PARK_UID = "DEADBEEF-0000-0000-0000-000000000000"  # 臨時角色暫時挪去的地方


def arg(name, default=None):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def count_uid(raw, want):
    n = 0
    i = raw.find(ANCHOR)
    while i >= 0:
        v = i + len(ANCHOR)
        if raw[v:v + 16] == want:
            n += 1
        i = raw.find(ANCHOR, v)
    return n


def convert(world, old_text, new_text, label):
    """把 Level.sav 與對應玩家檔的 old_text 換成 new_text。回傳 (幾處, 幾欄位)。"""
    level = os.path.join(world, "Level.sav")
    players = os.path.join(world, "Players")
    old_file = os.path.join(players, old_text.replace("-", "").upper() + ".sav")
    new_file = os.path.join(players, new_text.replace("-", "").upper() + ".sav")
    old_b, new_b = guid_bytes(old_text), guid_bytes(new_text)

    raw = decompress_save(level)
    hits = count_uid(raw, old_b)
    if hits == 0:
        print("  [%s] Level.sav 裡找不到 %s,略過" % (label, old_text))
        return 0, 0
    patched, n = patch(raw, old_b, new_b)
    rewrite(level, patched, save_type_of(level))

    fields = 0
    if os.path.isfile(old_file):
        fields = patch_player_file(old_file, old_text, new_text)
        os.rename(old_file, new_file)
    else:
        print("  [%s] 沒有玩家檔 %s(只改了 Level.sav)" % (label, os.path.basename(old_file)))
    print("  [%s] %s -> %s:Level.sav %d 處、玩家檔 %d 個欄位"
          % (label, old_text[:8], new_text[:8], n, fields))
    return n, fields


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    server_uid = arg("--server-uid")
    if not args or not server_uid:
        print(__doc__)
        return 2
    world = args[0]
    local_data = arg("--local-data")
    assume_yes = "--yes" in sys.argv

    level = os.path.join(world, "Level.sav")
    if not os.path.isfile(level):
        print("[X] 找不到 %s" % level)
        return 1

    raw = decompress_save(level)
    host_hits = count_uid(raw, guid_bytes(DEFAULT_OLD))
    temp_hits = count_uid(raw, guid_bytes(server_uid))
    print("世界資料夾 : %s" % world)
    print("單機主機玩家 %s : Level.sav 命中 %d 處" % (DEFAULT_OLD[:8], host_hits))
    print("伺服器玩家槽 %s : Level.sav 命中 %d 處" % (server_uid[:8], temp_hits))
    if host_hits == 0:
        print("[X] 找不到單機主機玩家 —— 這個世界不是從單機搬過來的,或已經轉換過了。")
        return 1

    todo = ["備份整個世界資料夾"]
    if os.path.isfile(os.path.join(world, "WorldOption.sav")):
        todo.append("把 WorldOption.sav 移進備份(它會蓋過伺服器設定)")
    if temp_hits:
        todo.append("把臨時角色 %s 先挪到 %s" % (server_uid[:8], PARK_UID[:8]))
    todo.append("把單機主機玩家換成 %s" % server_uid[:8])
    if local_data:
        todo.append("從 %s 複製 LocalData 回來(地圖探索)" % local_data)
    print("\n要做的事:")
    for i, t in enumerate(todo, 1):
        print("  %d. %s" % (i, t))

    if not assume_yes:
        try:
            if input("\n開始嗎?[Y/n] ").strip().lower() in ("n", "no"):
                print("已取消")
                return 0
        except (EOFError, KeyboardInterrupt):
            pass

    dst = "%s-BACKUP-%s" % (world.rstrip("\\/"), time.strftime("%Y%m%d-%H%M%S"))
    shutil.copytree(world, dst)
    print("\n已備份     : %s" % dst)

    wo = os.path.join(world, "WorldOption.sav")
    if os.path.isfile(wo):
        os.remove(wo)   # 備份裡still有一份,所以這裡直接移除
        print("  已移除 WorldOption.sav(備份裡仍保留一份)")

    # 臨時角色先讓位,否則兩個角色會搶同一個 UID
    if temp_hits:
        convert(world, server_uid, PARK_UID, "讓位")
    convert(world, DEFAULT_OLD, server_uid, "轉換")

    if local_data:
        src = os.path.join(local_data, "LocalData")
        if os.path.isdir(src):
            tgt = os.path.join(world, "LocalData")
            if os.path.isdir(tgt):
                shutil.rmtree(tgt)
            shutil.copytree(src, tgt)
            print("  已複製 LocalData(地圖探索)")
        else:
            print("  [!] %s 裡沒有 LocalData,地圖探索可能是空的" % local_data)

    # 驗證
    back = decompress_save(level)
    left = count_uid(back, guid_bytes(DEFAULT_OLD))
    now = count_uid(back, guid_bytes(server_uid))
    pf = os.path.join(world, "Players", server_uid.replace("-", "").upper() + ".sav")
    print("\n驗證       : 單機 UID 剩 %d 處、你的 UID %d 處、玩家檔存在 %s"
          % (left, now, os.path.isfile(pf)))
    if left == 0 and now > 0 and os.path.isfile(pf):
        print("\n[OK] 完成。開服前確認伺服器是關著的;進去之後檢查角色、帕魯、地圖探索。")
        print("     不對勁就把 %s 改回原本的名字還原。" % os.path.basename(dst))
        return 0
    print("\n[X] 驗證沒過 —— 請用備份還原:%s" % dst)
    return 1


if __name__ == "__main__":
    sys.exit(main())
