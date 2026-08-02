# -*- coding: utf-8 -*-
"""確保 PalWorldSettings.ini 有打開 REST API 與 RCON —— SteamCMD 版專用。

為什麼需要這支：
官方的 DefaultPalWorldSettings.ini 預設 RESTAPIEnabled=False、RCONEnabled=False、
AdminPassword=""。start.sh / start.bat 只是把它原樣複製過去，於是伺服器起來以後
排程器完全沒辦法跟它講話 —— 廣播、踢人、優雅關機、線上人數、即時座標全部失敗：

    [REST 廣播失敗] ... dial tcp 127.0.0.1:8212: connectex: ... actively refused it
    [RCON 失敗]     ... dial tcp 127.0.0.1:25575: ... actively refused it

Docker 版沒這問題（compose 帶的設定本來就開著），所以只有 SteamCMD 版會踩到。

原則：只補「不補就會壞」的東西，使用者自己調過的一律不動。
  - RESTAPIEnabled / RCONEnabled 強制 True（不開就沒有任何控制能力）
  - AdminPassword / ServerPassword 只在「原本是空的」時候才填
  - 其餘鍵一個都不碰，順序也原樣保留

用法：
    python ensure_server_ini.py <伺服器資料夾> [管理密碼] [進服密碼]
離開碼一律 0（設定不是啟動的必要條件，不該因為這裡失敗就擋住整個啟動流程）。
"""
import os
import shutil
import sys

SECTION = "[/Script/Pal.PalGameWorldSettings]"
KEY = "OptionSettings"


def split_fields(inner):
    """把 OptionSettings 括號內的內容切成 [(鍵, 值), ...]，引號內的逗號不算分隔。"""
    out, buf, quoted = [], [], False
    for ch in inner:
        if ch == '"':
            quoted = not quoted
        if ch == "," and not quoted:
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if buf:
        out.append("".join(buf))
    fields = []
    for f in out:
        f = f.strip()
        if not f:
            continue
        k, _, v = f.partition("=")
        fields.append((k.strip(), v))
    return fields


def config_dir(server_dir):
    """回傳設定檔所在資料夾。已存在的優先，都沒有就照平台挑。"""
    base = os.path.join(server_dir, "Pal", "Saved", "Config")
    for host in ("WindowsServer", "LinuxServer"):
        if os.path.isfile(os.path.join(base, host, "PalWorldSettings.ini")):
            return os.path.join(base, host)
    return os.path.join(base, "WindowsServer" if os.name == "nt" else "LinuxServer")


def read_option_line(path):
    """回傳 (整份行陣列, OptionSettings 所在索引)；找不到該行時索引為 -1。"""
    if not os.path.isfile(path):
        return None, -1
    with open(path, encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith(KEY + "="):
            return lines, i
    return lines, -1


def main():
    if len(sys.argv) < 2:
        print("[ini] 用法：ensure_server_ini.py <伺服器資料夾> [管理密碼] [進服密碼]")
        return 0
    server_dir = sys.argv[1]
    admin_pw = sys.argv[2] if len(sys.argv) > 2 else ""
    join_pw = sys.argv[3] if len(sys.argv) > 3 else ""

    if not os.path.isdir(server_dir):
        print("[ini] 找不到伺服器資料夾，略過：%s" % server_dir)
        return 0

    cfg_dir = config_dir(server_dir)
    ini = os.path.join(cfg_dir, "PalWorldSettings.ini")
    default_ini = os.path.join(server_dir, "DefaultPalWorldSettings.ini")

    lines, idx = read_option_line(ini)
    if lines is None:
        # 還沒有設定檔（伺服器第一次啟動前）→ 用官方範本建一份
        if not os.path.isfile(default_ini):
            print("[ini] 沒有 DefaultPalWorldSettings.ini 可參考，略過")
            return 0
        os.makedirs(cfg_dir, exist_ok=True)
        shutil.copyfile(default_ini, ini)
        print("[ini] 已建立 %s" % ini)
        lines, idx = read_option_line(ini)

    if idx < 0:
        # 檔案在、但沒有 OptionSettings（伺服器自己產生的空殼就長這樣）→ 從範本補一行
        _, didx = read_option_line(default_ini)
        if didx < 0:
            print("[ini] 設定檔沒有 OptionSettings 且範本也沒有，略過")
            return 0
        with open(default_ini, encoding="utf-8", errors="ignore") as f:
            option_line = f.read().splitlines()[didx]
        if SECTION not in lines:
            lines.append(SECTION)
        lines.append(option_line)
        idx = len(lines) - 1

    line = lines[idx]
    lp, rp = line.find("("), line.rfind(")")
    if lp < 0 or rp < lp:
        print("[ini] OptionSettings 格式看不懂，不動它")
        return 0

    fields = split_fields(line[lp + 1:rp])
    have = {k for k, _ in fields}
    changed = []

    def force(key, value, only_if_empty=False):
        for i, (k, v) in enumerate(fields):
            if k != key:
                continue
            if only_if_empty and v.strip().strip('"'):
                return  # 使用者已經自己填了，尊重它
            if v == value:
                return
            fields[i] = (k, value)
            changed.append("%s=%s" % (key, value))
            return
        # 範本裡沒有這個鍵（少見）→ 補在最後
        fields.append((key, value))
        changed.append("%s=%s（新增）" % (key, value))

    # 不開就沒有任何控制能力，一律強制
    force("RESTAPIEnabled", "True")
    force("RCONEnabled", "True")
    # 密碼只在原本是空的時候才填，使用者改過就不動
    if admin_pw:
        force("AdminPassword", '"%s"' % admin_pw, only_if_empty=True)
    if join_pw:
        force("ServerPassword", '"%s"' % join_pw, only_if_empty=True)

    if not changed:
        print("[ini] REST/RCON 已是開啟狀態，不需要調整")
        return 0

    lines[idx] = "%s=(%s)" % (KEY, ",".join("%s=%s" % (k, v) for k, v in fields))
    # 先寫暫存再改名，避免寫到一半被中斷就毀掉設定檔
    tmp = ini + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, ini)
    print("[ini] 已調整 %s" % ini)
    for c in changed:
        print("[ini]   %s" % c)
    if "RESTAPIEnabled" in have or "RCONEnabled" in have:
        print("[ini] 伺服器若正在執行，要重開才會生效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
