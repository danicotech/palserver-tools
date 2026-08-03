#!/usr/bin/env node
// 產生互動地圖的標記資料(快速旅行 / 地牢 / 寶箱 / 蛋 / 礦物 / NPC / 帕魯棲息地…)。
//
// 來源是 op.gg 帕魯地圖的兩份靜態 JSON:
//   points.json       56 類、約 14,000 個標記,格式 {"l":[worldX,worldY,z], "t":"子型別"}
//   points_i18n.json  11 個命名空間的譯名(pal / npc / dungeon / fastTravel …)
//
// 為什麼可以直接用:那組座標就是遊戲原生的世界座標,與存檔同一套。
// 實測拿它的 137 個快速旅行點對比專案既有的 landmarks.json,數量 137:137 相符、
// 經 savToMap 換算後距離中位數 0.36 地圖單位(整張圖約 3156 寬,誤差 0.01%),
// 所以不需要任何校正,世界樹也能靠 X 座標正確分流。
//
// 用法(專案根目錄):
//   node tools/fetch-map-points.mjs
// 產出 frontend/packages/web/public/game-data/map-points.json
//
// 注意:這份資料是 op.gg 整理的成果,不是遊戲直接提供的。要不要隨專案散布請自行確認授權。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "frontend", "packages", "web", "public", "game-data", "map-points.json");
const VER = process.argv[2] ?? "2026073103";
const BASE = "https://s-stats-platform-cdn.op.gg/palworld/meta";

// 與 @palserver/shared 的 savToMap / isWorldTreeCoord 完全一致 —— 這裡是純腳本,
// 不方便 import TS,故複製常數;改動時兩邊要一起改(值本身極少變)。
const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
const TREE_X = 350000;
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});

/** 分組與中文標籤 —— 對齊遊戲內與常見地圖網站的分類方式。 */
const GROUPS = [
  ["location", "地點", {
    FastTravels: "快速傳送", DungeonPortal: "地牢入口", DungeonFixed: "固定地牢",
    CaveEntrance: "洞穴入口", Home: "首頁", WatchTower: "瞭望塔", Respawn: "重生點",
    SkylandWarpAltar: "傳送環", RegionName: "地區名稱", HeatArea: "溫度區域",
    TreasureMap: "藏寶圖", Quest: "任務", Note: "筆記",
  }],
  ["enemy", "敵人", {
    BossTower: "組織之塔", FieldBoss: "區域頭目", Bounty: "通緝", Predator: "狂暴",
    EnemyCamp: "敵人營地", AntiAir: "防空砲塔", Incident: "事件",
  }],
  ["collect", "收集品", { LifmunkEffigy: "翠葉鼠雕像", SkillFruits: "技能果實樹" }],
  ["egg", "蛋", { Eggs: "帕魯蛋" }],
  ["fishing", "釣魚", { FishingSpot: "釣魚點", RareFishingSpot: "稀有釣點", Salvage: "打撈" }],
  ["mineral", "礦物", {
    OreMetal: "金屬礦石", OreCoal: "石炭", OreQuartz: "純水晶", OreQuartzCluster: "純水晶簇",
    OreSulfur: "硫磺", Chromites: "鉻鐵礦", RainbowCrystal: "六稜晶礦", SkyIslandOre: "烈陽金屬",
    WorldTreeOre: "世界樹礦石", AncientLava: "古代熔岩塊", AncientWood: "古代樹皮",
    AncientBeastBone: "古代獸骨",
  }],
  ["npc", "NPC", {
    NpcSalesPerson: "流浪商人", NpcPalDealer: "帕魯商人", NpcDarkTrader: "黑市商人",
    NpcMedalTrader: "獎章商人", NpcPalDisplay: "帕魯評論家", NpcEmote: "愛的傳教士",
    NpcPresenter: "帕魯馴養師", NpcBountyTrader: "賞金負責人", NpcOther: "其他 NPC",
  }],
  ["resource", "資源", {
    Chestbox: "寶箱", ElementTreasure: "屬性寶箱", NightStone: "夜星砂", Junk: "殘骸",
    Peach: "羈絆寶桃", BeautifulFlower: "美麗花朵", CrudeOil: "原油", Supply: "補給箱",
    LootTower: "隕石",
  }],
];

/** 值可能出現在這些欄位,依序試著解析出可讀名稱。 */
const NAME_FIELDS = ["name", "id", "ref", "type", "t", "k"];

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      Referer: "https://op.gg/",
    },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const pts = await getJson(`${BASE}/points.json?v=${VER}`);
const i18n = await getJson(`${BASE}/zh_TW/points_i18n.json?v=${VER}`);

const label = new Map();
for (const [, , cats] of GROUPS) for (const [k, v] of Object.entries(cats)) label.set(k, v);

const resolve = (val) => {
  if (typeof val !== "string") return null;
  for (const table of Object.values(i18n)) {
    if (table && typeof table === "object" && table[val]) return table[val];
  }
  return null;
};

const categories = {};
const points = {};
let total = 0;
let unknown = [];

for (const [groupKey, , cats] of GROUPS) {
  for (const cat of Object.keys(cats)) {
    const arr = pts[cat];
    if (!Array.isArray(arr)) {
      unknown.push(cat);
      continue;
    }
    const rows = [];
    let tree = 0;
    for (const p of arr) {
      const loc = p.l ?? p.loc;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      const [sx, sy] = loc;
      const isTree = sx > TREE_X;
      if (isTree) tree++;
      const { x, y } = savToMap(sx, sy);
      // 子型別/名稱:能翻的翻,翻不到就留原始值(至少能分色分群)
      let name = null;
      let sub = null;
      for (const f of NAME_FIELDS) {
        if (typeof p[f] !== "string") continue;
        name = resolve(p[f]);
        sub = p[f];
        if (name) break;
      }
      // [x, y, 世界(0=主/1=世界樹), 子型別, 名稱] —— 後兩欄沒有就省略,檔案才不會爆
      const row = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, isTree ? 1 : 0];
      if (sub) row.push(sub);
      if (name && name !== sub) row.push(name);
      rows.push(row);
    }
    categories[cat] = { label: label.get(cat) ?? cat, group: groupKey, count: rows.length, worldTree: tree };
    points[cat] = rows;
    total += rows.length;
  }
}

const out = {
  _comment:
    "互動地圖標記。座標已由世界座標經 savToMap 換算成地圖座標(與玩家/據點同一套)。" +
    "每筆為 [x, y, world(0=主世界,1=世界樹), 子型別?, 名稱?]。由 tools/fetch-map-points.mjs 產生。",
  version: VER,
  groups: GROUPS.map(([key, name, cats]) => ({ key, name, categories: Object.keys(cats) })),
  categories,
  points,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
// ---- NPC 頭像 ----
// 標記圖示絕大多數用專案既有素材(items/ 的物品圖、pals/ 的帕魯頭像、landmark-icons/),
// 只有這 10 張 NPC 頭像原本沒有,一併抓下來。都是遊戲美術,不是站方自製圖示。
// images/icons/ = 遊戲物品與 NPC 頭像;images/markers/ = 地圖標記語意圖(寶箱、釣場、地牢…)
const ICONS = [
  "SalesPerson", "PalDealer", "Male_DarkTrader01", "BountyTrader", "Human",
  "NPC_PalDisplay_1", "Female_Presenter01", "Emote_location_A_01",
  "Boss_Anubis", "PalEgg_Normal_01",
];
const MARKERS = [
  "fast-travel", "dungeon", "cave-entrance", "home", "watch-tower", "respawn",
  "skyland-warp-altar", "region", "heat", "treasure-map", "quest", "note",
  "boss-tower", "field-boss", "bounty", "predator", "enemy-camp", "anti-air", "incident",
  "effigy", "skill-fruit", "fishing", "salvage", "loot-tower",
  "ore-metal", "ore-coal", "ore-quartz", "ore-sulfur", "chromite", "rainbow-crystal",
  "sky-island-ore", "chest", "element-chest", "night-stone", "junk", "peach",
  "crude-oil", "supply", "oilrig-chest",
];
const ICON_DIR = path.join(ROOT, "frontend", "packages", "web", "public", "game-data", "map-icons");
fs.mkdirSync(ICON_DIR, { recursive: true });
let got = 0;
for (const [n, kind] of [...ICONS.map((x) => [x, "icons"]), ...MARKERS.map((x) => [x, "markers"])]) {
  const file = path.join(ICON_DIR, `${n}.webp`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
  try {
    const r = await fetch(`https://s-stats-platform-cdn.op.gg/palworld/images/${kind}/${n}.webp`, {
      headers: { Referer: "https://op.gg/" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    got++;
  } catch (e) {
    console.log(`  NPC 頭像 ${n} 下載失敗:${e.message}`);
  }
}
console.log(`標記圖示:新下載 ${got}、已有 ${ICONS.length + MARKERS.length - got}`);

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`已寫入 ${path.relative(ROOT, OUT)} — ${Object.keys(categories).length} 類、${total} 個標記、${kb} KB`);
if (unknown.length) console.log("來源沒有這些類別(可能已改名):", unknown.join(", "));

// 對照:來源共有多少類別沒被我們收進去
const covered = new Set(Object.keys(categories));
const skipped = Object.keys(pts).filter((k) => !covered.has(k) && Array.isArray(pts[k]));
if (skipped.length) console.log("未納入的來源類別:", skipped.join(", "));
