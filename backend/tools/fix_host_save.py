# -*- coding: utf-8 -*-
"""把「單機存檔的主機玩家」換成專用伺服器認得的 Steam UID。

為什麼需要這支:
單機(含單機多人連線)裡,主機玩家的 ID 是寫死的
00000000-0000-0000-0000-000000000001;專用伺服器則是用玩家的 Steam UID 去找人。
所以把單機存檔搬到專用伺服器之後,世界會照常載入、別人的角色也在,
只有「當初的主機」進去會拿到一隻全新角色 —— 而且不會有任何錯誤訊息。

做法(以及為什麼不用別的做法):
  * 不用「讀進結構再寫回去」。實測 palworld-save-tools 0.24.0 讀 v1.0 存檔時,
    45 MB 只解析出 9 MB,其餘 36 MB 被當成 trailer;照那樣寫回去會把公會、據點、
    地圖物件整段寫不見。網路上多數 fix_host_save 就是這樣毀掉存檔的。
  * 也不用「整檔搜尋取代 16 bytes」。舊 UID 的位元組在真實存檔裡裸出現超過
    一萬五千次(大量欄位剛好是 15 個 0 加 1),取代下去等於亂改。
  * 改用錨點:GVAS 裡的 PlayerUId 欄位有固定前綴
        "PlayerUId\\0" + len + "StructProperty\\0" + size(16) + len + "Guid\\0"
        + 16B 結構GUID + 1B 旗標 + 【16B 值】
    只有命中這個前綴、而且值剛好等於舊 UID 的地方才改。GUID 固定 16 bytes,
    長度不變 -> 檔案其餘位元組完全不動,沒有位移風險。
    OwnerPlayerUId 以 PlayerUId 結尾,同一個錨點會一起涵蓋到。

限制(請先知道):
  * 公會資料(GroupSaveDataMap)是不含欄位名的純二進位,沒有辦法安全定位,
    所以不處理 —— 角色和帕魯會回來,但公會身分可能要在遊戲裡重新加入。
  * 寫回時只能用 zlib(PlZ)容器:ooz 只提供解壓,沒有 Oodle 壓縮。
    Palworld 兩種容器都讀,但這點無法在此驗證,所以本工具一定會先備份。

用法:
    python fix_host_save.py <世界資料夾> <SteamID64> [--old <舊UID>] [--yes]

範例:
    python fix_host_save.py "...\\SaveGames\\0\\1892DB69..." 76561198844772802
"""
import io
import os
import shutil
import sys
import time
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "palsave"))

from extract_pals import decompress_save, load_gvas  # noqa: E402
from palworld_save_tools import palsav  # noqa: E402
from palworld_save_tools.gvas import GvasFile  # noqa: E402
from palworld_save_tools.paltypes import PALWORLD_TYPE_HINTS  # noqa: E402

STEAM_BASE = 76561197960265728
DEFAULT_OLD = "00000000-0000-0000-0000-000000000001"

# GVAS 裡一個 Guid 型別的 StructProperty 的完整前綴,值就接在它後面。
ANCHOR = (b"PlayerUId\x00\x0f\x00\x00\x00StructProperty\x00"
          b"\x10\x00\x00\x00\x00\x00\x00\x00\x05\x00\x00\x00Guid\x00"
          + b"\x00" * 16 + b"\x00")


def uid_from_steam(s):
    """SteamID64 -> 猜測的玩家 UID。**只當備案,不可信。**

    實測 v1.0 伺服器:steam_76561198844772802 對應的 Player id 是 649518AF,
    而「SteamID64 減基數再轉十六進位」算出來是 34B881C2 —— 對不上。
    Palworld 的對應規則不是這個,所以正確做法是直接看伺服器 log:

        [LOG] 某某 joined the server. (User id: steam_xxx, Player id: XXXXXXXX00000...)

    那個 Player id 就是答案。這個函式留著只是為了在沒有 log 時給個起點,
    用它之前一定要自己核對過。
    """
    n = int(s)
    if n > STEAM_BASE:
        n -= STEAM_BASE
    return "%08X-0000-0000-0000-000000000000" % n


def guid_bytes(text):
    """UE 的 GUID 位元組:四段 32-bit 各自 little-endian。

    不能用 Python 的 uuid.bytes_le —— 它只把前三段轉成 little-endian,最後
    8 bytes 維持原順序。兩者只有在「尾段不是 0」時才看得出差別,而單機主機的
    00000000-0000-0000-0000-000000000001 剛好就是那個情況:
        UE 實際存的  00000000 00000000 00000000 01000000
        bytes_le 給的 00000000 00000000 00000000 00000001
    差這一下,搜尋主機 UID 會一處都找不到,看起來就像「這個世界沒有單機角色」。
    一般玩家 UID(3EC9D66B-0000-...)尾段全是 0,兩種算法結果相同,所以這個
    錯誤在那些存檔上完全不會顯現 —— 實測真實存檔才抓到。
    """
    h = uuid.UUID(text).hex          # 32 個十六進位字元,已去掉 dash
    return b"".join(int(h[i:i + 8], 16).to_bytes(4, "little") for i in (0, 8, 16, 24))


def patch(raw, old, new):
    """只改「錨點後面剛好等於 old」的那 16 bytes,回傳 (新位元組, 改了幾處)。"""
    out = bytearray(raw)
    n = 0
    i = out.find(ANCHOR)
    while i >= 0:
        v = i + len(ANCHOR)
        if bytes(out[v:v + 16]) == old:
            out[v:v + 16] = new
            n += 1
        i = out.find(ANCHOR, v)
    return bytes(out), n


def save_type_of(path):
    """容器標頭的第 12 個位元組是 save type,重新壓縮時要原樣帶回去。"""
    with open(path, "rb") as f:
        return f.read(12)[11]


def rewrite(path, raw, stype):
    """壓回 .sav。只能產生 PlZ(zlib);寫檔用先暫存再改名,中途失敗不會毀原檔。"""
    blob = palsav.compress_gvas_to_sav(raw, stype)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, path)


def backup(world):
    dst = "%s-BACKUP-%s" % (world.rstrip("\\/"), time.strftime("%Y%m%d-%H%M%S"))
    shutil.copytree(world, dst)
    return dst


def patch_player_file(path, old_text, new_text):
    """改玩家檔裡的 PlayerUId / IndividualId.PlayerUId,回傳改了幾個欄位。

    先驗證「讀進來再原樣寫回去」和原檔位元組相同,不同就不動 ——
    這是確認這個版本的解析器真的吃得下這個檔案的唯一可靠方式。
    """
    raw = decompress_save(path)
    g = GvasFile.read(raw, PALWORLD_TYPE_HINTS, {}, allow_nan=True)
    if g.write({}) != raw:
        raise RuntimeError("玩家檔無法無損還原,為了安全不改它:%s" % path)

    old_u, new_u = uuid.UUID(old_text), uuid.UUID(new_text)
    changed = 0
    sd = g.properties["SaveData"]["value"]

    def set_uid(holder, key):
        nonlocal changed
        node = holder.get(key)
        if isinstance(node, dict) and node.get("value") == old_u:
            node["value"] = new_u
            changed += 1

    set_uid(sd, "PlayerUId")
    ind = sd.get("IndividualId", {}).get("value")
    if isinstance(ind, dict):
        set_uid(ind, "PlayerUId")

    rewrite(path, g.write({}), save_type_of(path))
    return changed


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    world, steam = args[0], args[1]
    old_text = DEFAULT_OLD
    for i, a in enumerate(sys.argv):
        if a == "--old" and i + 1 < len(sys.argv):
            old_text = sys.argv[i + 1]
    assume_yes = "--yes" in sys.argv

    level = os.path.join(world, "Level.sav")
    players_dir = os.path.join(world, "Players")
    if not os.path.isfile(level):
        print("[X] 找不到 %s" % level)
        return 1

    if steam.isdigit():
        new_text = uid_from_steam(steam)
        print("[!] 你給的是 SteamID64,推算出 %s" % new_text)
        print("    但 v1.0 的對應規則和這個算法不一致(實測會算錯)。")
        print("    請改用伺服器 log 裡那一行的 Player id:")
        print("      [LOG] ... joined the server. (User id: steam_xxx, Player id: 這一串)")
    else:
        new_text = steam
    old_b, new_b = guid_bytes(old_text), guid_bytes(new_text)
    old_file = os.path.join(players_dir, old_text.replace("-", "").upper() + ".sav")
    new_file = os.path.join(players_dir, new_text.replace("-", "").upper() + ".sav")

    print("世界資料夾 : %s" % world)
    print("舊 UID     : %s" % old_text)
    print("新 UID     : %s" % new_text)

    if not os.path.isfile(old_file):
        print("[X] 找不到主機玩家檔:%s" % old_file)
        print("    這個世界可能不是從單機搬過來的,或已經轉換過了。")
        return 1
    if os.path.isfile(new_file):
        print("[X] %s 已經存在 —— 這個 Steam 帳號在這個世界已經有角色了,不覆蓋。" % new_file)
        return 1

    raw = decompress_save(level)
    hits = 0
    i = raw.find(ANCHOR)
    while i >= 0:
        v = i + len(ANCHOR)
        if raw[v:v + 16] == old_b:
            hits += 1
        i = raw.find(ANCHOR, v)
    print("Level.sav  : 找到 %d 處要改的 PlayerUId 欄位" % hits)
    if hits == 0:
        print("[X] 一處都沒有 —— 不動任何東西。")
        return 1

    if not assume_yes:
        try:
            if input("  確定要轉換嗎?(會先自動備份整個世界資料夾)[Y/n] ").strip().lower() in ("n", "no"):
                print("已取消")
                return 0
        except (EOFError, KeyboardInterrupt):
            pass

    dst = backup(world)
    print("已備份     : %s" % dst)

    # Level.sav
    stype = save_type_of(level)
    patched, n = patch(raw, old_b, new_b)
    rewrite(level, patched, stype)
    print("Level.sav  : 已改 %d 處" % n)

    # 玩家檔:走結構化讀寫,不用錨點。
    # 玩家檔裡的 PlayerUId 排列和 Level.sav 不一樣(實測錨點命中 0 處),
    # 但它很小而且「完整解析得完」—— 讀進來原樣寫回去是位元組相同的,
    # 所以結構化改寫是這裡最安全的做法,也不必猜它的二進位版面。
    pn = patch_player_file(old_file, old_text, new_text)
    os.rename(old_file, new_file)
    print("玩家檔     : 已改 %d 個欄位,並改名為 %s" % (pn, os.path.basename(new_file)))

    # 驗證:重新讀回來,確認舊 UID 一個都不剩、新 UID 數量對得上、結構仍解得開
    back = decompress_save(level)
    left = new_cnt = 0
    i = back.find(ANCHOR)
    while i >= 0:
        v = i + len(ANCHOR)
        if back[v:v + 16] == old_b:
            left += 1
        if back[v:v + 16] == new_b:
            new_cnt += 1
        i = back.find(ANCHOR, v)
    ok = (left == 0 and new_cnt >= n and back == patched)
    try:
        load_gvas(level)
        parsed = True
    except Exception as e:
        parsed = False
        print("[X] 改完之後解析不開:%s" % e)
    print("驗證       : 舊 UID 剩 %d 處、新 UID %d 處、位元組一致 %s、可解析 %s"
          % (left, new_cnt, back == patched, parsed))
    if ok and parsed:
        print("\n[OK] 完成。進遊戲前記得先確認伺服器是關著的。")
        print("     萬一進去不對勁,把 %s 改回原本的名字即可還原。" % os.path.basename(dst))
        return 0
    print("\n[X] 驗證沒過 —— 請用備份還原:%s" % dst)
    return 1


if __name__ == "__main__":
    sys.exit(main())
