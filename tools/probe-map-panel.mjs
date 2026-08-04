#!/usr/bin/env node
// 窮舉測試:71 種標記分類,各自試出「詳細面板 API 到底吃什麼參數」。
//
// 為什麼要窮舉:map-detail-views 的 kind 不一定等於側欄的篩選鍵,
// 有些類別可能要帶 level、有些可能吃不同的 view 版本。
// 一個一個試比用猜的可靠,而且純打 API 很快(不必開瀏覽器)。
//
// 每個分類取 3 個真實座標,對每種參數組合各打一次,
// 只要有任一組回傳非空的 detail 就記下來。
//
// 用法(專案根目錄):node tools/probe-map-panel.mjs
// 產出 tools/map-panel-probe.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tools", "map-panel-probe.json");
const V = process.argv[2] ?? "2026080312";
const BASE = "https://s-stats-platform-cdn.op.gg/palworld/meta";
const API = "https://op.gg/zh-tw/palworld/api/map-detail-views";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
  Referer: "https://op.gg/zh-tw/palworld/map",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, retry = 1) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= retry) throw e;
      await sleep(600);
    }
  }
}

const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});

/** 側欄篩選鍵 → points.json 的來源類別 + 子型別過濾。
 *  鍵是從 op.gg 側欄逐一勾選、記錄網址 ?filters= 得到的。 */
const SRC = {
  effigy: ["LifmunkEffigy", "t"],
  egg: ["Eggs", "k"],
  fishing: ["FishingSpot", "type"],
  fishingSpot: ["FishingSpot", "type"],
  rareFishing: ["RareFishingSpot", "type"],
  salvage: ["Salvage", "type"],
  chest: ["Chestbox", "t"],
  lootTower: ["LootTower"],
  note: ["Note"],
  elementTreasure: ["ElementTreasure"],
  elementChest: ["ElementTreasure"],
  chestOilrig: ["Chestbox", "t"],
  chestOilrigGoal: ["Chestbox", "t"],
  fieldBoss: ["FieldBoss"],
  boss: ["BossTower"],
  bossTower: ["BossTower"],
  bounty: ["Bounty"],
  predator: ["Predator"],
  enemyCamp: ["EnemyCamp"],
  antiAir: ["AntiAir"],
  incident: ["Incident"],
  fastTravel: ["FastTravels"],
  respawn: ["Respawn"],
  skylandWarpAltar: ["SkylandWarpAltar"],
  home: ["Home"],
  watchTower: ["WatchTower"],
  region: ["RegionName"],
  regionName: ["RegionName"],
  dungeon: ["DungeonPortal"],
  caveEntrance: ["CaveEntrance"],
  treasureMap: ["TreasureMap"],
  heatArea: ["HeatArea"],
  quest: ["Quest"],
  oreMetal: ["OreMetal"],
  oreCoal: ["OreCoal"],
  oreQuartz: ["OreQuartz"],
  oreQuartzCluster: ["OreQuartzCluster"],
  oreSulfur: ["OreSulfur"],
  chromites: ["Chromites"],
  chromite: ["Chromites"],
  rainbowCrystal: ["RainbowCrystal"],
  skyIslandOre: ["SkyIslandOre"],
  ancientLava: ["AncientLava"],
  ancientWood: ["AncientWood"],
  ancientBeastBone: ["AncientBeastBone"],
  npcSalesPerson: ["NpcSalesPerson"],
  npcPalDealer: ["NpcPalDealer"],
  npcDarkTrader: ["NpcDarkTrader"],
  npcMedalTrader: ["NpcMedalTrader"],
  npcPalDisplay: ["NpcPalDisplay"],
  npcEmote: ["NpcEmote"],
  npcPresenter: ["NpcPresenter"],
  npcBountyTrader: ["NpcBountyTrader"],
  npcOther: ["NpcOther"],
  skillFruits: ["SkillFruits"],
  skillFruit: ["SkillFruits"],
  supply: ["Supply"],
  junk: ["Junk"],
  peach: ["Peach"],
  beautifulFlower: ["BeautifulFlower"],
  crudeOil: ["CrudeOil"],
  nightStone: ["NightStone"],
};

const keysPath = process.argv[3];
const keys = keysPath && fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, "utf8")) : null;
const pts = await getJson(`${BASE}/points.json?v=${V}`);

/** 分類清單:有 keys.json 就用它(名稱較齊),否則用 SRC 的鍵 */
const targets = keys
  ? Object.entries(keys).map(([name, v]) => ({ name, key: v.key, n: v.n }))
  : Object.keys(SRC).map((k) => ({ name: k, key: k, n: (pts[SRC[k][0]] ?? []).length }));

/** 取這個篩選鍵對應的幾個真實座標 */
function samplesFor(key) {
  const [base, sub] = key.split(":");
  const spec = SRC[base];
  if (!spec) return [];
  const [cat, field] = spec;
  let arr = pts[cat] ?? [];
  if (sub && field) {
    arr = arr.filter((p) => {
      const v = p[field];
      return typeof v === "string" && (v === sub || v.toLowerCase().startsWith(sub.toLowerCase()));
    });
  }
  return arr.slice(0, 2).map((p) => {
    const loc = p.l ?? p.loc ?? [];
    const { x, y } = savToMap(loc[0], loc[1]);
    return { id: `${Math.round(x)},${Math.round(y)}`, lv: typeof p.lv === "number" ? p.lv : undefined };
  });
}

/** 要嘗試的參數組合。view 版本與帶不帶 level 都試,
 *  用完整鍵(effigy:Carbunclo)與基底鍵(effigy)各試一次。 */
function variants(key, s) {
  const base = key.split(":")[0];
  const kinds = base === key ? [key] : [key, base];
  const out = [];
  for (const kind of kinds) {
    out.push({ kind, id: s.id, view: "4" });
    if (s.lv !== undefined) out.push({ kind, id: s.id, view: "4", level: String(s.lv) });
  }
  return out;
}

/** detail 是否真的有內容(不只是回一個空殼) */
function meat(d) {
  if (!d || typeof d !== "object") return null;
  const lists = {};
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v) && v.length) lists[k] = v.length;
  }
  const hasTitle = d.title && d.title !== d.id;
  if (!Object.keys(lists).length && !hasTitle) return null;
  return { title: d.title, fields: Object.keys(d), lists, sample: JSON.stringify(d).slice(0, 260) };
}

const results = {};
let i = 0;
for (const t of targets) {
  const ss = samplesFor(t.key);
  const rec = { key: t.key, n: t.n, samples: ss.length };
  if (!ss.length) {
    rec.note = "找不到對應的來源座標";
  } else {
    let best = null;
    let tried = 0;
    outer: for (const s of ss) {
      for (const v of variants(t.key, s)) {
        tried++;
        const q = new URLSearchParams({ ...v, v: V });
        try {
          const r = await getJson(`${API}?${q}`);
          const m = meat(r.detail ?? r);
          if (m) {
            best = { params: v, ...m };
            break outer;
          }
        } catch {
          /* 這組參數不通,換下一組 */
        }
        await sleep(120);
      }
    }
    rec.tried = tried;
    if (best) Object.assign(rec, best);
  }
  results[t.name] = rec;
  const mark = rec.title ? `OK  ${rec.title}  ${JSON.stringify(rec.lists ?? {})}` : `--  ${rec.note ?? "無資料"}`;
  console.log(`  [${String(++i).padStart(2)}/${targets.length}] ${t.name.padEnd(13)} ${String(t.n).padStart(5)}  ${mark.slice(0, 76)}`);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
}

const ok = Object.values(results).filter((r) => r.title).length;
console.log(`\n有面板資料 ${ok} / ${targets.length} 類`);
console.log(`已寫入 ${path.relative(ROOT, OUT)}`);
