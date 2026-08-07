# -*- coding: utf-8 -*-
"""確保伺服器真的會載入「有資料的那個世界」—— SteamCMD 版專用。

為什麼需要這支:
把別台的存檔複製進 Pal\\Saved\\SaveGames\\0\\ 之後,伺服器不會自動用它。
伺服器只認 GameUserSettings.ini 的 DedicatedServerName,對不上就默默開一個
全新的空世界 —— 不報錯、不提示。於是變成:

    面板讀得到你的存檔(它會掃整個 SaveGames\\0),
    遊戲卻是全新的世界。

而且兩邊挑世界的規則不一樣,人工對字串很容易再錯一次:少一個字、多一對
引號、大小寫不同,面板就會退回「挑最新的 Level.sav」,抓到伺服器正在寫的
那個空世界,畫面反而整個變空。

所以這裡在啟動前先對一次:
  - 沒有任何存檔        -> 什麼都不做(全新伺服器的正常狀態)
  - 設定值指到不存在的  -> 自動改成實際存在的那個世界
  - 設定值指到空世界,   -> 問一句要不要改用有資料的那個(預設要)
    但另一個世界有玩家
  - 已經對上            -> 不動

原則和 ensure_server_ini.py 一致:只補「不補就會壞」的東西,改之前先備份,
使用者自己設過的值不亂動;離開碼一律 0,設定不該擋住啟動流程。

用法:
    python ensure_world.py <伺服器資料夾> [--yes]
    --yes  不互動(全部照建議做),給排程/無人值守用
"""
import io
import os
import shutil
import sys

SECTION = "[/Script/Pal.PalGameLocalSettings]"
KEY = "DedicatedServerName"


def worlds_in(server_dir):
    """列出 SaveGames\\0 底下每個含 Level.sav 的世界,附大小、玩家檔數、時間。"""
    base = os.path.join(server_dir, "Pal", "Saved", "SaveGames", "0")
    out = []
    if not os.path.isdir(base):
        return out
    for name in sorted(os.listdir(base)):
        lvl = os.path.join(base, name, "Level.sav")
        if not os.path.isfile(lvl):
            continue
        players_dir = os.path.join(base, name, "Players")
        players = 0
        if os.path.isdir(players_dir):
            players = len([f for f in os.listdir(players_dir) if f.lower().endswith(".sav")])
        st = os.stat(lvl)
        out.append({"name": name, "size": st.st_size, "mtime": st.st_mtime, "players": players})
    return out


def ini_paths(server_dir):
    """回傳 (伺服器實際會讀的 ini, 其他也存在的 ini)。

    Windows 版讀 WindowsServer、Linux 版讀 LinuxServer。兩個都在通常是把
    Docker 版的 Config 整包複製過來造成的 —— 那會讓面板(先找 LinuxServer)
    和伺服器讀到不同檔案,是個很難自己發現的坑,所以要一起處理。
    """
    base = os.path.join(server_dir, "Pal", "Saved", "Config")
    mine = "WindowsServer" if os.name == "nt" else "LinuxServer"
    other = "LinuxServer" if mine == "WindowsServer" else "WindowsServer"
    primary = os.path.join(base, mine, "GameUserSettings.ini")
    strays = [p for p in [os.path.join(base, other, "GameUserSettings.ini")] if os.path.isfile(p)]
    return primary, strays


def read_name(ini):
    """讀出 DedicatedServerName 的值;檔案不在或沒有這個鍵就回 None。"""
    try:
        with io.open(ini, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.strip().startswith(KEY + "="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return None


def write_name(ini, value):
    """把 DedicatedServerName 設成 value。改之前留一份 .bak(只留最初那份)。"""
    lines = []
    if os.path.isfile(ini):
        with io.open(ini, encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
        bak = ini + ".bak"
        if not os.path.exists(bak):
            try:
                shutil.copyfile(ini, bak)
                print("[world] 已備份原始設定:%s" % bak)
            except OSError as e:
                print("[world] 備份失敗(不影響設定調整):%s" % e)

    hit = False
    for i, line in enumerate(lines):
        if line.strip().startswith(KEY + "="):
            lines[i] = "%s=%s" % (KEY, value)
            hit = True
            break
    if not hit:
        # 沒有這個鍵就補進它該在的區段;連區段都沒有(或整個檔案不存在)就補一個。
        if SECTION in lines:
            lines.insert(lines.index(SECTION) + 1, "%s=%s" % (KEY, value))
        else:
            if lines and lines[-1].strip():
                lines.append("")
            lines.append(SECTION)
            lines.append("%s=%s" % (KEY, value))

    os.makedirs(os.path.dirname(ini), exist_ok=True)
    tmp = ini + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, ini)


def describe(w):
    mb = w["size"] / 1048576.0
    return "%s(%.1f MB、%d 個玩家檔)" % (w["name"], mb, w["players"])


def ask(question, assume_yes):
    """問一句是非題,預設「是」。非互動(排程、管線)時直接照預設走。"""
    if assume_yes:
        return True
    try:
        ans = input("  %s [Y/n] " % question).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return True
    return ans not in ("n", "no")


def main():
    if len(sys.argv) < 2:
        print("用法:python ensure_world.py <伺服器資料夾> [--yes]")
        return 0
    server_dir = sys.argv[1]
    assume_yes = "--yes" in sys.argv[2:]

    worlds = worlds_in(server_dir)
    if not worlds:
        print("[world] 還沒有任何存檔(第一次開服後才會產生),不需要調整")
        return 0

    ini, strays = ini_paths(server_dir)
    current = read_name(ini)
    by_name = {w["name"]: w for w in worlds}
    # 「最該用的」= 玩家檔最多,同分再比 Level.sav 大小 —— 複製進來的正式存檔
    # 一定贏過伺服器剛開的空世界。
    best = max(worlds, key=lambda w: (w["players"], w["size"]))

    for p in strays:
        print("[world] 注意:%s 也存在。" % p)
        print("[world]   面板會優先讀 LinuxServer 那份,伺服器讀的卻是另一份,")
        print("[world]   兩邊會對不起來。那是從 Docker 版複製過來才會有的,建議刪掉。")

    if current and current in by_name:
        cur = by_name[current]
        if cur["players"] > 0 or len(worlds) == 1 or best["name"] == current:
            print("[world] 世界設定正確:%s" % describe(cur))
            return 0
        # 設定指到一個沒有玩家的世界,而另一個世界有 —— 幾乎都是「複製了存檔
        # 進來,但伺服器仍開自己那個空世界」。
        print("[world] 目前設定的世界沒有任何玩家:%s" % describe(cur))
        print("[world] 但這裡有一個有資料的世界:%s" % describe(best))
        if not ask("要改成載入有資料的那個嗎?", assume_yes):
            print("[world] 保持原樣")
            return 0
    elif current:
        print("[world] 設定指到的世界不存在:%s" % current)
    else:
        print("[world] 設定裡沒有指定世界")

    write_name(ini, best["name"])
    for p in strays:
        write_name(p, best["name"])
    print("[world] 已設定成載入:%s" % describe(best))
    if best["players"] == 0:
        print("[world] 這個世界沒有 Players 資料夾或裡面是空的 —— 如果是從別台複製")
        print("[world]   過來的,記得把 Players 整個資料夾一起複製,否則角色會重來。")
    print("[world] 伺服器重開後生效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
