#!/usr/bin/env node
// 產生「點擊標記後的詳細面板」資料:標題、副標、掉落表(含圖示與機率)。
//
// 端點是 op.gg 前端實際在用的那一支,參數從它的 JS bundle 反解出來:
//   /api/map-detail-views?kind=<分類鍵>&id=<x,y>&v=<版本>&view=4
//   id 是「地圖座標」四捨五入到整數(實測前端送 -1186,-829,該點世界座標是十萬等級)
//
// 關鍵:id 有兩種形態,弄錯就一律回 detail:null(我為此白繞了好幾輪)——
//   coord 型:lootTower / treasureMap  → id 是地圖座標四捨五入 "x,y"
//   code  型:其餘                     → id 是 points.json 裡的子型別代號,
//             例如 fieldBoss=BOSS_Horus_Water、predator=PREDATOR_SifuDog、
//             bounty=BOSS_Male_NinjaElite、dungeon=Dungeon_Grass_01、
//             supply=Volcano_Supply、fishing=FishingSpot_A_Ocean_Common
//
// code 型的好處是可以大量去重:區域頭目 90 個座標其實只有數十種帕魯,
// 釣場 529 個座標只對應 108 種釣點,請求數因此少一個量級。
// 其餘類別的詳細資料在別的端點:寶箱在 chest-views、筆記在 note-views、
// 任務在 mission-views、事件在 incident-views、技能果實在 skill-fruit-views
// (都由 tools/fetch-map-detail.mjs 處理);礦石/蛋/雕像本來就沒有掉落資料。
//
// 為什麼不用爬 UI:標記畫在 canvas 上、沒有 DOM 節點可點,只能用滑鼠掃描,
// 一個分類要三十幾秒,而且整頁重載幾次 Chrome 就會崩潰。直接打 API 快上百倍。
//
// 用法(專案根目錄):node tools/fetch-map-panel.mjs
// 產出 frontend/packages/web/public/game-data/map-panel.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const OUT = path.join(WEB, "map-panel.json");
const V = process.argv[2] ?? "2026080312";
const BASE = "https://s-stats-platform-cdn.op.gg/palworld/meta";
const API = "https://op.gg/zh-tw/palworld/api/map-detail-views";
const CONCURRENCY = 4;
// 連續打約 1800 筆之後對方會開始限流,全部請求變成失敗。
// 降併發 + 遇錯退避重試 + 續跑(已抓到的不重抓),整份就能一次跑完。
const RETRY = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** points.json 的來源類別 → 面板 API 的 kind。
 *  鍵值是從 op.gg 側欄逐一勾選、記錄網址 ?filters= 得到的(見 keys.json)。 */
/** points.json 類別 → { kind, id 來源 }。
 *  idFrom = "coord" 用地圖座標;其餘是要拿哪個欄位當代號。 */
const KIND = {
  LootTower: { kind: "lootTower", idFrom: "coord" },
  TreasureMap: { kind: "treasureMap", idFrom: "coord" },
  FieldBoss: { kind: "fieldBoss", idFrom: "name", level: true },
  Predator: { kind: "predator", idFrom: "id", level: true },
  Bounty: { kind: "bounty", idFrom: "name", level: true },
  DungeonPortal: { kind: "dungeon", idFrom: "name" },
  DungeonFixed: { kind: "dungeon", idFrom: "name" },
  Supply: { kind: "supply", idFrom: "t" },
  FishingSpot: { kind: "fishing", idFrom: "t" },
  RareFishingSpot: { kind: "fishing", idFrom: "t" },
};

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
  Referer: "https://op.gg/zh-tw/palworld/map",
  Accept: "application/json",
};

async function getJson(url, retry = RETRY) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= retry) throw e;
      // 指數退避:被限流時愈退愈久,給對方喘息
      await sleep(Math.min(30000, 800 * 2 ** i));
    }
  }
}

// id 是「地圖座標」四捨五入,不是世界座標 —— 實測 op.gg 前端送的是
// -1186,-829,而該點的世界座標是十萬等級。用 savToMap 換算後再取整。
const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});

const pts = await getJson(`${BASE}/points.json?v=${V}`);

/** 要抓的 (kind, id) 清單。code 型會大量重複,先去重再抓。 */
const jobs = [];
const seen = new Set();
for (const [cat, spec] of Object.entries(KIND)) {
  for (const p of pts[cat] ?? []) {
    const loc = p.l ?? p.loc;
    if (!Array.isArray(loc) || loc.length < 2) continue;
    let id;
    if (spec.idFrom === "coord") {
      const { x, y } = savToMap(loc[0], loc[1]);
      id = `${Math.round(x)},${Math.round(y)}`;
    } else {
      id = p[spec.idFrom];
      if (typeof id !== "string" || !id) continue;
    }
    const lv = spec.level && typeof p.lv === "number" ? p.lv : undefined;
    const key = `${spec.kind}:${id}:${lv ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ kind: spec.kind, id, lv });
  }
}
console.log(`要抓 ${jobs.length} 筆(${new Set(jobs.map((j) => j.kind)).size} 種 kind)`);

/** 只留畫面上用得到的欄位,並把長尾掉落砍掉 —— 全存下來會是好幾十 MB。 */
const trimItems = (items) =>
  (items ?? [])
    .slice()
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 30)
    .map((it) => ({
      n: it.name,
      i: it.iconName,
      // 數量欄位是 min/max(不是 qty);相同就寫一個數字,不同才寫成範圍
      q: it.min === it.max ? it.min : `${it.min}–${it.max}`,
      r: it.rate,
      // groupName 是「設計圖 / 素材 / 消耗品」這種分類,面板可以拿來分區
      c: it.groupName || undefined,
    }));

function compact(d) {
  if (!d || typeof d !== "object") return null;
  const out = {};
  if (d.title) out.t = d.title;
  if (d.subtitle) out.s = d.subtitle;
  if (d.label && d.label !== d.title) out.l = d.label;
  if (d.iconName) out.i = d.iconName;
  if (d.description) out.d = String(d.description).replace(/<[^>]+>/g, "").trim().slice(0, 400);
  // 掉落表可能叫 drops / items / groups / grades,一律收斂成 g:[{label, items}]
  const groups = [];
  if (Array.isArray(d.drops)) groups.push({ l: "掉落物", items: trimItems(d.drops) });
  for (const pool of d.pools ?? []) groups.push({ l: pool.label ?? "釣獲", items: trimItems(pool.items ?? pool.fishes) });
  if (Array.isArray(d.items)) groups.push({ l: "掉落物", items: trimItems(d.items) });
  for (const g of d.groups ?? []) groups.push({ l: g.label ?? g.element ?? "", items: trimItems(g.items) });
  for (const g of d.grades ?? []) groups.push({ l: `品階 ${g.grade}`, items: trimItems(g.items) });
  for (const v of d.variants ?? []) {
    for (const g of v.grades ?? []) groups.push({ l: v.label ?? `品階 ${g.grade}`, items: trimItems(g.items) });
  }
  if (groups.length) out.g = groups.filter((g) => g.items.length);
  return Object.keys(out).length ? out : null;
}

// 續跑:已經抓到的就跳過,被限流中斷後再跑一次即可補齊
const result = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")).panels ?? {}) : {};
const already = Object.values(result).reduce((a, v) => a + Object.keys(v).length, 0);
if (already) console.log(`  已有 ${already} 筆,只補沒抓到的`);
let done = 0;
let ok = 0;
let empty = 0;
let fail = 0;

async function one(job) {
  if (result[job.kind]?.[job.id]) { done++; return; }
  const q = new URLSearchParams({ kind: job.kind, id: job.id, v: V, view: "4" });
  if (job.lv !== undefined) q.set("level", String(job.lv));
  try {
    const d = await getJson(`${API}?${q}`);
    const c = compact(d.detail ?? d);
    if (c) {
      (result[job.kind] ??= {})[job.id] = c;
      ok++;
    } else empty++;
  } catch {
    fail++;
  }
  if (++done % 500 === 0) console.log(`  ${done}/${jobs.length}  有內容 ${ok} / 空 ${empty} / 失敗 ${fail}`);
}

let idx = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < jobs.length) await one(jobs[idx++]);
  }),
);

const out = {
  _comment:
    "地圖標記的詳細面板資料(標題 / 副標 / 掉落表)。" +
    "第一層是 kind(對應 op.gg 的篩選鍵),第二層是世界座標 \"x,y\"。" +
    "掉落項目 {n:名稱, i:圖示代號, q:數量, r:機率%}。由 tools/fetch-map-panel.mjs 產生。",
  version: V,
  panels: result,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n有內容 ${ok} / 空 ${empty} / 失敗 ${fail}`);
console.log(`已寫入 ${path.relative(ROOT, OUT)} — ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
for (const [k, v] of Object.entries(result)) console.log(`   ${k.padEnd(18)} ${Object.keys(v).length}`);
