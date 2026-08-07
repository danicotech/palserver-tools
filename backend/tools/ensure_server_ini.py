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
import io
import json
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


def warn_pw(fields, want, cfg_path):
    """伺服器的 AdminPassword 和面板要用的那組對不上時,講清楚要改哪裡。

    只警告不覆蓋:那是使用者伺服器上正在用的密碼,改掉會把所有管理員擋在外面。
    """
    if not want:
        return
    have = ""
    for k, v in fields:
        if k == "AdminPassword":
            have = v.strip().strip('"')
            break
    if have == want:
        return
    print("[ini] [!] 伺服器的 AdminPassword 和面板要用的密碼不一樣 —— 面板會一直 401,")
    print("[ini]   在線人數、廣播、踢人、優雅關服都會失效。二選一:")
    print("[ini]   1. 把 %s 的 rcon.password 改成伺服器現在這組" % (cfg_path or "backend/config.json"))
    print("[ini]   2. 或把伺服器 ini 的 AdminPassword 改成面板這組,再重開伺服器")
    if not have:
        print("[ini]   (伺服器現在是空密碼 —— 空密碼的話官方 REST 一律拒絕連線)")


def main():
    if len(sys.argv) < 2:
        print("[ini] 用法：ensure_server_ini.py <伺服器資料夾> [管理密碼] [進服密碼]")
        return 0
    server_dir = sys.argv[1]
    args = [a for a in sys.argv[2:] if not a.startswith("--")]
    admin_pw = args[0] if len(args) > 0 else ""
    join_pw = args[1] if len(args) > 1 else ""

    # --config <path>:以面板的 config.json 為準。
    # 面板連伺服器用的是 rcon.password,伺服器認的是 ini 裡的 AdminPassword;
    # 兩邊由不同檔案各自維護,只要有一邊沒填就是 401,而錯誤訊息
    # (Unauthorized: AdminPassword is empty)完全看不出是誰跟誰沒對上。
    # 這裡直接讓「面板要用的那組」成為唯一權威來源。
    cfg_pw = ""
    cfg_path = ""
    for i, a in enumerate(sys.argv):
        if a == "--config" and i + 1 < len(sys.argv):
            cfg_path = sys.argv[i + 1]
    if cfg_path:
        try:
            with io.open(cfg_path, encoding="utf-8") as f:
                cfg_pw = (json.load(f).get("rcon") or {}).get("password") or ""
        except Exception as e:
            print("[ini] 讀不到 %s(%s),改用命令列給的密碼" % (cfg_path, e))
    if cfg_pw:
        admin_pw = cfg_pw

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
    if lp < 0:
        print("[ini] OptionSettings 沒有 \"(\"，格式看不懂，不動它")
        return 0

    truncated = rp < lp
    if truncated:
        # 被截斷的檔案(實際遇過:停在 ServerPassword=\"...\", 就沒了)。
        # 少了結尾的 ")" 之外,RCONEnabled / RESTAPIEnabled 這些也一起不見了 ——
        # 伺服器把不存在的開關當成 False,面板就永遠 401,而且和密碼無關。
        # 以前這裡直接放棄,等於自動修正對最需要修的檔案沒作用。
        print("[ini] [!] OptionSettings 沒有收尾的 \")\"，這一行被截斷了 —— 自動修復")
        fields = split_fields(line[lp + 1:].rstrip().rstrip(","))
    else:
        fields = split_fields(line[lp + 1:rp])

    # 截斷會連鍵一起吃掉,從官方範本把缺的補回來(使用者已有的值一律不動)
    if truncated:
        have_keys = {k for k, _ in fields}
        dlines, didx2 = read_option_line(default_ini)
        if didx2 >= 0:
            dline = dlines[didx2]
            dlp, drp = dline.find("("), dline.rfind(")")
            if dlp >= 0 and drp > dlp:
                restored = []
                for k, v in split_fields(dline[dlp + 1:drp]):
                    if k not in have_keys:
                        fields.append((k, v))
                        restored.append(k)
                if restored:
                    print("[ini]   從官方範本補回 %d 個被截掉的設定:%s%s"
                          % (len(restored), "、".join(restored[:6]),
                             "…" if len(restored) > 6 else ""))
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

    warn_pw(fields, admin_pw, cfg_path)

    if not changed and not truncated:
        print("[ini] REST/RCON 已是開啟狀態，不需要調整")
        return 0

    lines[idx] = "%s=(%s)" % (KEY, ",".join("%s=%s" % (k, v) for k, v in fields))
    # 第一次動別人的設定檔前，先留一份原始備份。
    # 面板可以指到「已經自己跑了好一陣子」的伺服器資料夾，那份 ini 裡可能有一堆
    # 手調過的參數；就算這裡只改 REST/RCON，也該讓人有辦法還原。
    # 只在備份不存在時建立 —— 否則跑第二次就會把備份蓋成已修改的版本。
    bak = ini + ".bak"
    if not os.path.exists(bak):
        try:
            shutil.copyfile(ini, bak)
            print("[ini] 已備份原始設定:%s" % bak)
        except OSError as e:
            print("[ini] 備份失敗（不影響設定調整）:%s" % e)
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
