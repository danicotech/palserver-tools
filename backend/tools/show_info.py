# -*- coding: utf-8 -*-
"""印出「現在實際生效的連線資訊」:網址、埠、密碼、伺服器名稱。

為什麼從批次檔搬到這裡:
原本的 show-info.bat 同時具備三個條件 —— 大量中文、要帶入變數、有 goto/call。
cmd 執行 goto 時是用「位元組偏移」回頭定位檔案,而 codepage 65001 下它逐位元組
讀檔,前面的中文讓偏移量對不上,跳回去的位置就落在某一行中間,後半段被當成
指令執行。實際症狀:

    '無密碼、埠' is not recognized as an internal or external command

ui.bat 用「中文放 .txt、用 type 印」繞開這件事,但這裡要嵌入 %PORT% %PW% 這些
值,type 不夠用。改由 Python 輸出最乾淨:批次檔那邊只剩純 ASCII,不會再被切。

SteamCMD 版的伺服器設定不在 .env,而是全部擠在 PalWorldSettings.ini 的一行
OptionSettings=(...) 裡,所以要自己切欄位。

用法:
    python show_info.py <伺服器資料夾> [面板埠,預設 9000]
"""
import io
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ensure_server_ini import split_fields  # noqa: E402  同一套切法,不重寫


def lan_ip():
    """對外連線用的本機 IP。不會真的送出封包,只是讓系統挑出對外網卡。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "你的IP"
    finally:
        s.close()


def read_options(ini):
    """把 OptionSettings=(...) 拆成 dict;檔案不在或格式不對就回空的。"""
    if not os.path.isfile(ini):
        return None
    try:
        with io.open(ini, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.strip().startswith("OptionSettings="):
                    lp, rp = line.find("("), line.rfind(")")
                    if lp < 0 or rp < lp:
                        return {}
                    return {k: v.strip().strip('"')
                            for k, v in split_fields(line[lp + 1:rp])}
    except OSError:
        pass
    return {}


def main():
    srv = sys.argv[1] if len(sys.argv) > 1 else ""
    panel_port = sys.argv[2] if len(sys.argv) > 2 else "9000"
    # normpath:批次檔傳進來的路徑可能混用 / 和 \,直接印出來會很難看
    def cfg(host):
        return os.path.normpath(os.path.join(srv, "Pal", "Saved", "Config", host,
                                             "PalWorldSettings.ini"))
    ini = cfg("WindowsServer")
    if not os.path.isfile(ini):
        alt = cfg("LinuxServer")
        if os.path.isfile(alt):
            ini = alt

    opt = read_options(ini)
    ip = lan_ip()
    port = (opt or {}).get("PublicPort") or "8211"

    line = "=" * 50
    print("")
    print(line)
    print("  連線資訊")
    print(line)
    print("  查詢網站   http://localhost:%s   (區網 http://%s:%s)" % (panel_port, ip, panel_port))
    print("  遊戲連線   %s:%s   (UDP,同一台可用 127.0.0.1:%s)" % (ip, port, port))

    if opt is None:
        print("-" * 50)
        print("  設定檔還沒產生(伺服器第一次啟動後才會出現):")
        print("    %s" % ini)
        print("  在那之前是官方預設值:無密碼、埠 8211。")
        print(line)
        print("")
        return 0

    pw, admin = opt.get("ServerPassword", ""), opt.get("AdminPassword", "")
    print("  進服密碼   %s" % (pw if pw else "(沒有設密碼,直接連)"))
    print("  管理密碼   %s" % (admin if admin else "(沒有設)"))
    if opt.get("ServerName"):
        print("  伺服器名稱 %s" % opt["ServerName"])
    print("-" * 50)
    print("  改密碼/埠/倍率就編輯這個檔,存檔後重開伺服器:")
    print("    %s" % ini)
    if (opt.get("RESTAPIEnabled") or "").lower() != "true":
        print("  提示:RESTAPIEnabled=False —— 網站看不到在線玩家與即時位置,建議改成 True。")
    if (opt.get("RCONEnabled") or "").lower() != "true":
        print("  提示:RCONEnabled=False —— 排程器無法廣播、踢人、優雅關服。")
    if not admin:
        print("  提示:AdminPassword 是空的 —— 官方 REST 一律拒絕連線,面板會一直 401。")
    print(line)
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
