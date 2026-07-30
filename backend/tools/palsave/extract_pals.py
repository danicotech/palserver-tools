#!/usr/bin/env python3
"""解析 Palworld 存檔 Level.sav，輸出每位玩家擁有的帕魯清單（JSON）。

- 支援新版 PlM(Oodle) 壓縮（Palworld v0.6+/v1.0），用開源 pyooz 解壓，不需專有 DLL。
- 以 runtime monkeypatch 容忍 v1.0 存檔中 palworld-save-tools 尚未支援的新欄位/型別，
  故可直接對 `pip install` 的乾淨套件執行，不必手改 site-packages。
- 種類代號會用同目錄 pal_names.json 轉成中/英文名。

安裝：
    pip install -r requirements.txt      # palworld-save-tools, pyooz

用法：
    python extract_pals.py <Level.sav> [-o out.json] [--player <名稱或UID>] [--quiet]

輸出 JSON 結構：
    { "total_pals": N, "orphan_pals": N,
      "players": [ { "name","uid","level","pal_count",
                     "pals":[ {"species","name_zh","name_en","level","gender",
                               "rank","iv_hp","iv_attack","iv_defense",
                               "is_alpha","is_lucky","nickname"} ] } ] }
"""
import sys
import os
import re
import json
import argparse

try:
    import ooz  # pyooz：開源 Oodle 解壓（PlM 用）
except ImportError:
    sys.exit("缺少 pyooz，請先：pip install pyooz")
try:
    from palworld_save_tools.gvas import GvasFile
    from palworld_save_tools.paltypes import PALWORLD_TYPE_HINTS, PALWORLD_CUSTOM_PROPERTIES
    from palworld_save_tools import archive as _archive
    from palworld_save_tools.rawdata import character as _character
except ImportError:
    sys.exit("缺少 palworld-save-tools，請先：pip install palworld-save-tools")

PREFIXES = ["BOSS_", "PREDATOR_", "SUMMON_", "RAID_", "GYM_"]
ALPHA_PREFIXES = ("BOSS_", "PREDATOR_")


# ---------- 相容性 monkeypatch：讓舊版 parser 能讀新版 v1.0/PlM 存檔 ----------
def _tolerant_decode_bytes(parent_reader, char_bytes):
    """角色 RawData：需要的 object 在最前面已完整解析，忽略新版尾端多出的位元組。"""
    reader = parent_reader.internal_copy(bytes(char_bytes), debug=False)
    return {"object": reader.properties_until_end()}


_character.decode_bytes = _tolerant_decode_bytes


def _tolerant_properties_until_end(self, path=""):
    """遇到本工具未支援的型別（如新版的 SetProperty）時，保留已解析的屬性並停止此層，
    而非整個解析失敗。CharacterSaveParameterMap 位於 worldSaveData 最前段，故能完整取得。"""
    properties = {}
    while True:
        name = self.fstring()
        if name == "None":
            break
        type_name = self.fstring()
        size = self.u64()
        try:
            properties[name] = self.property(type_name, size, f"{path}.{name}")
        except Exception:
            break
        # 本工具只需要 CharacterSaveParameterMap（玩家與帕魯皆在此）。一旦取得就停止解析
        # worldSaveData 的後續屬性，避免新版存檔尾段區段（如 LevelObjectRecoverPartySaveData）
        # 造成的位元組流錯位，同時大幅加速（讀數 KB 即停，不必跑完上百 MB）。
        if path == ".worldSaveData" and name == "CharacterSaveParameterMap":
            break
    return properties


_archive.FArchiveReader.properties_until_end = _tolerant_properties_until_end


# ---------- 小工具 ----------
def g(d, *ks, default=None):
    for k in ks:
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def sv(sp, key, default=None):
    """取屬性純量值：逐層拆掉 {'value': ...} 包裝，處理 Enum 的 '::' 尾段。"""
    v = g(sp, key, "value")
    seen = 0
    while isinstance(v, dict) and "value" in v and seen < 6:
        v = v["value"]
        seen += 1
    if v is None:
        return default
    if isinstance(v, str) and "::" in v:
        return v.split("::")[-1]
    return v


def prettify(internal):
    return re.sub(r"(?<!^)(?=[A-Z])", " ", internal).replace("_", " ").strip()


# 玩家配點名稱（存檔內為日文/中文混用）→ 統一鍵
STATUS_POINT_MAP = {
    "最大HP": "hp", "最大SP": "stamina", "攻撃力": "attack",
    "所持重量": "weight", "捕獲率": "capture", "作業速度": "workspeed",
}


def resolve_species(species):
    """去掉 BOSS_/PREDATOR_… 前綴，回傳 (基礎代號, 是否為 α)。"""
    key = species
    is_alpha = False
    for pre in PREFIXES:
        if key.startswith(pre):
            is_alpha = pre in ALPHA_PREFIXES
            key = key[len(pre):]
            break
    return key, is_alpha


def lookup_entry(species, table):
    """以基礎代號查表；找不到再去掉屬性/變體尾綴（如 Monkey_Fire → Monkey）試一次。"""
    key, _ = resolve_species(species)
    ent = table.get(key)
    if ent is None and "_" in key:
        ent = table.get(key.rsplit("_", 1)[0])
    return ent


def name_lookup(species, names):
    """回傳 (zh, en, is_alpha)。找不到就以美化後的代號當英文名。"""
    _, is_alpha = resolve_species(species)
    ent = lookup_entry(species, names)
    if ent:
        key, _ = resolve_species(species)
        return ent.get("zh") or ent.get("en") or prettify(key), ent.get("en") or "", is_alpha
    key, _ = resolve_species(species)
    return prettify(key), prettify(key), is_alpha


def map_skills(ids, table):
    """把技能/被動內部 ID 陣列轉成顯示名（繁中優先，找不到就美化代號）。"""
    out = []
    for sid in ids or []:
        ent = table.get(sid)
        if ent:
            out.append(ent.get("zh") or ent.get("en") or prettify(sid))
        else:
            out.append(prettify(sid.split("::")[-1]))
    return out


def hp_scaled(sp, key):
    """HP 類欄位（Hp/ShieldHP）存檔內為 ×1000 內部值，除回真實值。"""
    raw = g(sp, key, "value", "Value", "value")
    return round(raw / 1000) if isinstance(raw, (int, float)) else None


def status_points(sp):
    """玩家已配點：{hp, stamina, attack, weight, capture, workspeed}。"""
    out = {}
    for it in g(sp, "GotStatusPointList", "value", "values", default=[]) or []:
        nm = g(it, "StatusName", "value")
        pt = g(it, "StatusPoint", "value")
        if nm is not None:
            out[STATUS_POINT_MAP.get(nm, nm)] = pt
    return out


def location_of(sp):
    loc = g(sp, "LastJumpedLocation", "value", default=None)
    if isinstance(loc, dict) and "x" in loc:
        return {k: round(loc[k]) for k in ("x", "y", "z") if isinstance(loc.get(k), (int, float))}
    return None


def load_maps(here):
    """讀取所有對照表；缺檔回空 dict（僅少了該類資料，不影響其他）。"""
    def load(fn):
        p = os.path.join(here, fn)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        return {}
    return {
        "names": load("pal_names.json"),
        "skills": load("skill_names.json"),
        "passives": load("passive_names.json"),
        "static": load("pal_static.json"),
    }


def load_gvas(path):
    with open(path, "rb") as f:
        data = f.read()
    ulen = int.from_bytes(data[0:4], "little")
    clen = int.from_bytes(data[4:8], "little")
    magic = data[8:11]
    if magic == b"PlM":  # 新版 Oodle
        raw = ooz.decompress(data[12:12 + clen], ulen)
    elif magic == b"PlZ":  # 舊版 zlib
        import zlib
        raw = zlib.decompress(data[12:])
    elif magic == b"CNK":
        import zlib
        raw = zlib.decompress(data[24:])
    else:
        sys.exit(f"未知存檔格式 magic={magic!r}")
    if raw[:4] != b"GVAS":
        sys.exit(f"解壓後不是 GVAS：{raw[:8]!r}")
    wanted = {k: v for k, v in PALWORLD_CUSTOM_PROPERTIES.items()
              if "CharacterSaveParameterMap" in k}
    return GvasFile.read(raw, PALWORLD_TYPE_HINTS, wanted, allow_nan=True)


def build_pal(sp, maps):
    species = sv(sp, "CharacterID", default="?")
    zh, en, is_alpha = name_lookup(species, maps["names"])
    st = lookup_entry(species, maps["static"]) or {}
    return {
        "species": species, "name_zh": zh, "name_en": en,
        "nickname": sv(sp, "NickName", default=""),
        "paldeck": st.get("paldeck", ""),
        "elements": st.get("elements", []),
        "level": int(sv(sp, "Level", default=1) or 1),
        "exp": sv(sp, "Exp", default=0),
        "gender": sv(sp, "Gender", default=""),
        "rank": sv(sp, "Rank", default=1),        # 星級 1-5
        "souls": {                                # 靈魂強化等級（濃縮/強化）
            "hp": sv(sp, "Rank_HP", default=0),
            "attack": sv(sp, "Rank_Attack", default=0),
            "defense": sv(sp, "Rank_Defence", default=0),
            "craftspeed": sv(sp, "Rank_CraftSpeed", default=0),
        },
        "iv_hp": sv(sp, "Talent_HP", default=0),
        "iv_attack": sv(sp, "Talent_Shot", default=0),   # 攻擊個體值＝Talent_Shot
        "iv_defense": sv(sp, "Talent_Defense", default=0),
        "hp": hp_scaled(sp, "Hp"),
        "friendship": sv(sp, "FriendshipPoint", default=0),
        "stomach": round(sv(sp, "FullStomach", default=0) or 0),
        "food_buff": sv(sp, "FoodWithStatusEffect", default=""),
        "work": st.get("work", {}),
        "is_alpha": is_alpha,
        "is_lucky": bool(sv(sp, "IsRarePal", default=False)),
        "active_skills": map_skills(g(sp, "EquipWaza", "value", "values"), maps["skills"]),
        "mastered_skills": map_skills(g(sp, "MasteredWaza", "value", "values"), maps["skills"]),
        "passives": map_skills(g(sp, "PassiveSkillList", "value", "values"), maps["passives"]),
    }


def build_player(sp, uid):
    return {
        "name": sv(sp, "NickName", default="(unknown)"),
        "uid": uid,
        "level": int(sv(sp, "Level", default=1) or 1),
        "exp": sv(sp, "Exp", default=0),
        "hp": hp_scaled(sp, "Hp"),
        "shield_hp": hp_scaled(sp, "ShieldHP"),
        "stomach": round(sv(sp, "FullStomach", default=0) or 0),
        "hunger": sv(sp, "HungerType", default=""),
        "health": sv(sp, "PhysicalHealth", default=""),
        "unused_status_point": sv(sp, "UnusedStatusPoint", default=0),
        "status_points": status_points(sp),
        "voice_id": sv(sp, "VoiceID", default=0),
        "location": location_of(sp),
    }


def extract(gvas, maps):
    chars = gvas.properties["worldSaveData"]["value"]["CharacterSaveParameterMap"]["value"]
    players, pals_by_owner = {}, {}
    total_pals = orphan = 0
    for e in chars:
        key_uid = str(g(e, "key", "PlayerUId", "value", default=""))
        sp = g(e, "value", "RawData", "value", "object", "SaveParameter", "value", default={})
        if sv(sp, "IsPlayer", default=False):
            players[key_uid] = build_player(sp, key_uid)
            continue
        total_pals += 1
        owner = sv(sp, "OwnerPlayerUId")
        if owner is None:
            oo = g(sp, "OldOwnerPlayerUIds", "value", "values", default=[])
            owner = str(oo[-1]) if oo else None
        owner = str(owner) if owner else None
        if owner is None:
            orphan += 1
            continue
        pals_by_owner.setdefault(owner, []).append(build_pal(sp, maps))

    out = {"total_pals": total_pals, "orphan_pals": orphan, "players": []}
    for uid, p in players.items():
        pals = sorted(pals_by_owner.get(uid, []), key=lambda x: -x["level"])
        p["pal_count"] = len(pals)
        p["pals"] = pals
        out["players"].append(p)
    out["players"].sort(key=lambda x: -x["pal_count"])
    return out


def main():
    ap = argparse.ArgumentParser(description="解析 Palworld 存檔，輸出玩家帕魯清單")
    ap.add_argument("save", help="Level.sav 路徑")
    ap.add_argument("-o", "--out", help="輸出 JSON 路徑（預設 <save>.pals.json）")
    ap.add_argument("--player", help="只輸出此玩家（名稱或 UID，部分比對）")
    ap.add_argument("--quiet", action="store_true", help="不印摘要")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    maps = load_maps(here)

    out = extract(load_gvas(args.save), maps)

    if args.player:
        q = args.player.lower()
        out["players"] = [p for p in out["players"]
                          if q in p["name"].lower() or q in p["uid"].lower()]

    dst = args.out or (args.save + ".pals.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    if not args.quiet:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        print(f"玩家 {len(out['players'])} 人、帕魯 {out['total_pals']} 隻"
              f"（無主 {out['orphan_pals']}）→ {dst}")
        for p in out["players"][:15]:
            print(f"  {p['name']} (Lv.{p['level']}) — {p['pal_count']} 隻")


if __name__ == "__main__":
    main()
