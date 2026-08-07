# -*- coding: utf-8 -*-
"""把面板與腳本更新到最新版,不動任何使用者資料。

為什麼可以直接覆蓋:
GitHub 下載的壓縮檔只包含「進版控的檔案」。使用者的東西全都在 .gitignore 裡 ——

    backend/config.json      設定與 API token
    .env                     密碼
    backend/data/            上線時數、頭像、快取、記住的伺服器資料夾
    windows/native/server/   伺服器本體與存檔(6 GB)
    windows/native/tools/    可攜版 Python / Node / Go
    frontend/**/dist/        已建置的網站

所以壓縮檔裡根本沒有這些路徑,覆蓋上去不可能蓋到。這比「列一串排除清單」可靠:
排除清單會漏,而「來源就沒有」不會。

更新完不需要重跑 install —— 伺服器本體和可攜版工具都在原地。

用法:
    python update_tools.py <專案資料夾> [--ref main] [--dry-run]
"""
import io
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile

REPO = "danicotech/palserver-tools"
# 這些即使出現在壓縮檔裡也不覆蓋 —— 現在不會,但萬一哪天誤加進版控,
# 使用者的設定也不該被一個更新指令蓋掉。
NEVER = {"backend/config.json", ".env"}


def arg(name, default=None):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    root = os.path.abspath(args[0])
    ref = arg("--ref", "main")
    dry = "--dry-run" in sys.argv

    if not os.path.isfile(os.path.join(root, "windows", "native", "start-all.bat")):
        print("[X] 這裡不像是專案資料夾(找不到 windows\\native\\start-all.bat):")
        print("    %s" % root)
        return 1

    url = "https://codeload.github.com/%s/zip/refs/heads/%s" % (REPO, ref)
    print("下載 %s ..." % url)
    tmp = tempfile.mkdtemp(prefix="palupd-")
    try:
        zp = os.path.join(tmp, "src.zip")
        with urllib.request.urlopen(url, timeout=120) as r, io.open(zp, "wb") as f:
            shutil.copyfileobj(r, f)
        print("  %.1f MB" % (os.path.getsize(zp) / 1048576))

        with zipfile.ZipFile(zp) as z:
            z.extractall(tmp)
        tops = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))]
        src = os.path.join(tmp, tops[0])

        copied = skipped = 0
        for dirpath, _, names in os.walk(src):
            for n in names:
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, src).replace("\\", "/")
                if rel in NEVER:
                    skipped += 1
                    continue
                dst = os.path.join(root, rel.replace("/", os.sep))
                if not dry:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(full, dst)
                copied += 1
        print("%s %d 個檔案%s" % ("將更新" if dry else "已更新", copied,
                                  (",略過 %d 個(使用者設定)" % skipped) if skipped else ""))
        if dry:
            print("(--dry-run:實際上什麼都沒動)")
            return 0

        print("")
        print("完成。你的存檔、設定、可攜版工具都沒有被動到:")
        for p in ("backend/config.json", ".env", "backend/data",
                  "windows/native/server", "windows/native/tools"):
            full = os.path.join(root, p.replace("/", os.sep))
            if os.path.exists(full):
                print("  保留 %s" % p)
        print("")
        print("接著雙擊 windows\\native\\start-all.bat 即可(不用重跑 install)。")
        return 0
    except Exception as e:
        print("[X] 更新失敗:%s: %s" % (type(e).__name__, e))
        print("    網路不通或 GitHub 擋住時會這樣;可以自己下載 zip 解壓覆蓋。")
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
