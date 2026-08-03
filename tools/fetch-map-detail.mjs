#!/usr/bin/env node
// 產生「地圖標記詳細資料」:標題、分類、掉落表、商店品項。
//
// 為什麼需要這支:points.json 只有座標,沒有名字。地圖上因此只能顯示
// 「事件 1」「筆記 2」這種流水號。真正的名稱散在另外七個 api/*-views 端點,
// 這些端點的路徑是從 op.gg 的 JS bundle 反解出來的(靠猜路徑會漏掉一半)。
//
// 端點與內容:
//   incident-views    168 個事件,1099 個生成點,含標題 / 分類 / 參戰 NPC
//   note-views         64 篇筆記,含標題 / 分類 / 內文
//   mission-views     117 個任務,其中 87 個有座標
//   chest-views        24 種寶箱,1610 個座標,含完整掉落表與機率
//   shop-views         38 間商店,含品項與售價
//   skill-fruit-views   9 棵技能果實樹,含果實清單
//   npc-detail-views   19 個 NPC 補充說明
//
// 座標換算:incident / note / mission 是世界座標,需經 savToMap;
// chest / skill-fruit 的 mapLocations 已經是地圖座標,直接用。
// 腳本會自行驗證換算方向(見 verifyProjection),方向錯就中止而不是默默產出爛資料。
//
// 用法(專案根目錄):node tools/fetch-map-detail.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const OUT = path.join(WEB, "map-detail.json");
const V = "2026080312";
const API = (n) => `https://op.gg/zh-tw/palworld/api/${n}?v=${V}`;

const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
/** 世界座標 → 地圖座標,與 fetch-map-points / fetch-pal-spawns 同一套 */
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});
const r1 = (n) => Math.round(n * 10) / 10;
const ckey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

async function api(name) {
  const r = await fetch(API(name), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
      Referer: "https://op.gg/zh-tw/palworld/map",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
  return r.json();
}

// ── 先確認換算方向沒搞反 ────────────────────────────────────────────
// 拿事件座標換算後,去比對 points.json 裡既有的 Incident 座標。
// 兩者是同一批生成點,對得上才代表方向正確。
function verifyProjection(locations) {
  const existing = JSON.parse(fs.readFileSync(path.join(WEB, "map-points.json"), "utf8"));
  const known = new Set((existing.points.Incident ?? []).map((p) => ckey(p[0], p[1])));
  if (!known.size) return; // 舊檔沒有 Incident 就跳過驗證
  const hit = (fn) => {
    let n = 0;
    for (const l of locations) {
      const { x, y } = fn(l);
      if (known.has(ckey(x, y))) n++;
    }
    return n;
  };
  const a = hit((l) => savToMap(l.x, l.y));
  const b = hit((l) => savToMap(l.y, l.x));
  console.log(`  換算驗證:正向命中 ${a} / 反向命中 ${b}(共 ${locations.length} 點,已知 ${known.size} 點)`);
  if (a < b) throw new Error(`座標換算方向反了(正向 ${a} < 反向 ${b}),請檢查 savToMap`);
  if (a === 0) throw new Error("座標換算後完全對不上既有標記,格式可能已變更");
}

console.log("抓取七個詳細資料端點…");
const [incRaw, noteRaw, misRaw, chestRaw, shopRaw, fruitRaw, npcRaw] = await Promise.all(
  ["incident-views", "note-views", "mission-views", "chest-views", "shop-views", "skill-fruit-views", "npc-detail-views"].map(api),
);

// ── 事件 ────────────────────────────────────────────────────────────
// 同一個生成點會隨機刷出多種事件,所以是「座標 → 事件清單」而不是一對一。
// 地圖上顯示第一筆標題 +N,和 op.gg 的呈現一致。
const incidents = incRaw.incidents.map((e) => ({
  t: e.title,
  c: e.category,
  n: e.npcNames?.length ? e.npcNames : undefined,
  lv: e.minLevel && e.maxLevel ? [e.minLevel, e.maxLevel] : undefined,
}));
verifyProjection(incRaw.incidents.flatMap((e) => e.locations ?? []));

const incidentAt = {};
const incZ = {};
incRaw.incidents.forEach((e, i) => {
  for (const l of e.locations ?? []) {
    const { x, y } = savToMap(l.x, l.y);
    const k = ckey(x, y);
    (incidentAt[k] ??= []).push(i);
    if (l.z != null) incZ[k] = Math.round(l.z / 100); // 公分 → 公尺
  }
});

// ── 筆記 / 任務 ─────────────────────────────────────────────────────
// 這兩類的 locations 帶 key,points.json 的第 5 欄也是同一個 key,
// 所以用 key 對接比用座標穩(座標有四捨五入誤差)。
const notes = {};
for (const n of noteRaw.notes) {
  for (const l of n.locations ?? []) {
    notes[l.key] = {
      t: n.title,
      c: n.category,
      x: (n.excerpt || n.body || "").replace(/<[^>]+>/g, "").trim().slice(0, 300) || undefined,
      z: l.z != null ? Math.round(l.z / 100) : undefined,
    };
  }
}

const missions = {};
for (const m of misRaw.missions) {
  for (const l of m.locations ?? []) {
    missions[l.key] = {
      t: m.title,
      y: m.type,
      x: (m.description || "").replace(/<[^>]+>/g, "").trim().slice(0, 300) || undefined,
      exp: m.exp || undefined,
      z: l.z != null ? Math.round(l.z / 100) : undefined,
    };
  }
}

// ── 寶箱 ────────────────────────────────────────────────────────────
// mapLocations 已是地圖座標,連 index(序號)都給好了。
// 掉落表按品階分組,每項有機率;機率極低的長尾對玩家沒意義,砍到前 40 項。
const trimItems = (items) =>
  (items ?? [])
    .slice()
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 40)
    .map((it) => ({ n: it.name, i: it.iconName, q: it.qty, r: it.rate }));

const chests = {};
const chestAt = {};
for (const c of chestRaw.chests) {
  chests[c.slug] = {
    l: c.label,
    g: (c.variants ?? []).flatMap((v) =>
      (v.grades ?? []).map((g) => ({ grade: g.grade, items: trimItems(g.items) })),
    ),
  };
  for (const l of c.mapLocations ?? []) chestAt[ckey(l.x, l.y)] = c.slug;
}

// ── 技能果實樹 ──────────────────────────────────────────────────────
// 這是地圖上原本完全沒有的一類標記 —— points.json 沒收錄。
const fruitTrees = [];
const skillFruit = {};
for (const s of fruitRaw.sources) {
  skillFruit[s.slug] = {
    l: s.label,
    g: (s.groups ?? []).map((g) => ({ el: g.element, l: g.label, items: trimItems(g.items) })),
  };
  for (const l of s.mapLocations ?? []) {
    fruitTrees.push([r1(l.x), r1(l.y), l.z != null ? Math.round(l.z) : 0, s.slug]);
  }
}

// ── 商店 / NPC ──────────────────────────────────────────────────────
const shops = shopRaw.shops.map((s) => ({
  l: s.label,
  cur: s.currencyName,
  curIcon: s.currencyIconName,
  items: (s.items ?? []).map((it) => ({ n: it.name, i: it.iconName, p: it.price, q: it.qty, once: it.once || undefined })),
}));

const npc = {};
for (const d of npcRaw.details) {
  const notes_ = (d.sections ?? []).map((s) => s.note || s.label).filter(Boolean);
  if (notes_.length) npc[d.label] = notes_;
}

const out = {
  _comment:
    "地圖標記詳細資料(標題 / 分類 / 掉落表 / 商店品項)。" +
    "incidentAt / chestAt 以四捨五入到整數的地圖座標 \"x,y\" 為鍵,對應 map-points.json 的同一批座標;" +
    "notes / missions 以 points.json 第 5 欄的 key 為鍵。由 tools/fetch-map-detail.mjs 產生。",
  version: V,
  incidents,
  incidentAt,
  incidentZ: incZ,
  notes,
  missions,
  chests,
  chestAt,
  skillFruit,
  fruitTrees,
  shops,
  npc,
};
fs.writeFileSync(OUT, JSON.stringify(out));

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`
  事件       ${incidents.length} 種 → ${Object.keys(incidentAt).length} 個生成點
  筆記       ${Object.keys(notes).length} 個座標
  任務       ${Object.keys(missions).length} 個座標
  寶箱       ${Object.keys(chests).length} 種 → ${Object.keys(chestAt).length} 個座標
  技能果實樹 ${Object.keys(skillFruit).length} 種 → ${fruitTrees.length} 個座標
  商店       ${shops.length} 間
  NPC 說明   ${Object.keys(npc).length} 個
已寫入 ${path.relative(ROOT, OUT)} — ${kb} KB`);
