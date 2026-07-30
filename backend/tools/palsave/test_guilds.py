# -*- coding: utf-8 -*-
"""本機驗證 guilds/bases 解析:python test_guilds.py <Level.sav>"""
import sys, glob, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_pals import load_gvas, extract, load_maps, extract_guilds  # noqa: E402

save = sys.argv[1] if len(sys.argv) > 1 else max(
    glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "palworld-data", "Pal", "Saved", "SaveGames", "0", "*", "Level.sav")),
    key=os.path.getmtime,
)
print("save:", save)
out = extract(load_gvas(save), load_maps(os.path.dirname(os.path.abspath(__file__))))
gs = extract_guilds(save)
print(f"guilds: {len(gs)} | players: {len(out['players'])} | total_pals: {out['total_pals']}")
total_bases = sum(len(g["bases"]) for g in gs)
print("total bases:", total_bases)
uid2name = {p["uid"]: p["name"] for p in out["players"]}
for g in sorted(gs, key=lambda x: -len(x["member_uids"]))[:8]:
    names = [uid2name.get(u, "?") for u in g["member_uids"]]
    print(f"  - {g['name']!r:24} lv={g['level']} members={len(g['member_uids'])} {names[:4]} bases={len(g['bases'])} {g['bases'][:2]}")
assert gs, "沒解析到任何公會"
assert total_bases > 0, "沒解析到任何據點"
assert all(isinstance(b.get("x"), int) for g in gs for b in g["bases"]), "base 座標型別錯誤"
known = sum(1 for g in gs for u in g["member_uids"] if u in uid2name)
allm = sum(len(g["member_uids"]) for g in gs)
print(f"member uid 對上玩家名: {known}/{allm}")
print("OK")
