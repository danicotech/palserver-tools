# -*- coding: utf-8 -*-
"""把地圖圖磚從 PNG 轉成 WebP,體積剩約 1/7。

為什麼值得做:
下載回來的圖磚是 PNG,整包約 108 MB。第一次進站要抓幾十張,在慢一點的
連線上就是等。實測同一批圖磚轉成 WebP q90 只有原本的 14.7%(約 16 MB),
而 PSNR 平均 49.9 dB、最差 38.9 dB —— 40 dB 以上肉眼幾乎無法分辨,
對地圖這種內容是划算的交換。

用法(在專案根目錄):
    python tools/optimize-map-tiles.py            # 轉檔並刪掉原本的 PNG
    python tools/optimize-map-tiles.py --keep     # 保留 PNG(兩種格式並存)
    python tools/optimize-map-tiles.py --quality 95

需要 Pillow:python -m pip install Pillow
轉完重新建置前端(Docker 版:docker compose up -d --build panel)。
網站會自動偵測 .webp,沒有就退回 .png,再沒有就退回單張底圖。
"""
import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow:python -m pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "frontend", "packages", "web", "public", "map-tiles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", type=int, default=90, help="WebP 品質(預設 90)")
    ap.add_argument("--keep", action="store_true", help="保留原本的 PNG")
    args = ap.parse_args()

    if not os.path.isdir(TILES):
        sys.exit("找不到 %s —— 請先執行 node tools/fetch-map-tiles.mjs" % TILES)

    pngs = []
    for dirpath, _, names in os.walk(TILES):
        for n in names:
            if n.endswith(".png"):
                pngs.append(os.path.join(dirpath, n))
    if not pngs:
        print("沒有 PNG 可轉(可能已經轉過了)")
        return 0

    print("轉換 %d 張圖磚 → WebP q%d%s" % (len(pngs), args.quality, "" if args.keep else "(轉完刪除 PNG)"))
    before = after = 0
    for i, src in enumerate(pngs, 1):
        dst = src[:-4] + ".webp"
        try:
            size_in = os.path.getsize(src)
            # method=6 最慢但壓最好;圖磚只轉一次,值得
            Image.open(src).save(dst, "WEBP", quality=args.quality, method=6)
            before += size_in
            after += os.path.getsize(dst)
            if not args.keep:
                os.remove(src)
        except Exception as e:
            print("  失敗 %s:%s" % (os.path.relpath(src, TILES), e))
        if i % 500 == 0:
            print("  %d/%d" % (i, len(pngs)))

    mb = 1024 * 1024
    print("\n完成:%.1f MB → %.1f MB(%.1f%%,省下 %.1f MB)"
          % (before / mb, after / mb, after / before * 100 if before else 0, (before - after) / mb))
    print("記得重新建置前端讓 dist 帶上新檔案。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
