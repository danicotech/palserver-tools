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

/** 分組與分類定義。
 *
 *  每個分類可以是:
 *    "標籤"                          → 整個來源類別當一類
 *    { src, label, split, only }     → 依子型別拆開,或只取符合條件的點
 *
 *  拆分是必要的:蛋有 7 種產地、雕像有 11 種帕魯、寶箱又分一般與石油平台,
 *  混在一起只能整組開關,實際上玩家要找的往往是「火山蛋」而不是「所有蛋」。
 */
const EGG_REGION = {
  grass: "草原蛋", desert: "沙漠蛋", volcano: "火山蛋", snow: "雪原蛋",
  sakurajima: "櫻花島蛋", darkisland: "天墜蛋", skyisland: "天陽鄉蛋",
};
const FISH_LV = {
  Easy: "初級釣場", Normal: "中級釣場", Difficult: "高級釣場",
  VeryDifficult: "達人釣場", ExtremelyDifficult: "專家釣場",
  // 極難釣場(IMPOSSIBLE):來源有這一級,但遊戲裡沒有,不收。
};
const FISHING = FISH_LV;
const RARE_FISHING = Object.fromEntries(Object.entries(FISH_LV).map(([k, v]) => [k, `稀有${v}`]));

const EFFIGY = {
  Carbunclo: "翠葉鼠雕像", SheepBall: "棉悠悠雕像", Penguin: "企丸丸雕像",
  IceCrocodile: "肚肚鱷雕像", FlameBambi: "燎火鹿雕像", LeafMomonga: "達鼠泥雕像",
  Monkey: "新葉猿雕像", NegativeKoala: "瞅什魔雕像",
  // 搗蛋貓雕像:來源有這筆,但遊戲裡沒有這種雕像,不收。
  Mutant: "秘斯媞雅雕像", LazyDragon: "佩克龍雕像", GuardianDog: "八雲犬雕像",
};

const GROUPS = [
  ["collect", "收集品", {
    LifmunkEffigy: { split: "t", labels: EFFIGY },
    LootTower: "古代遺跡",
    Note: "筆記",
  }],
  ["egg", "蛋", {
    Eggs: { split: "k", labels: EGG_REGION, keyOf: (v) => (v ?? "").split("_")[0].toLowerCase() },
  }],
  ["enemy", "敵人", {
    BossTower: "組織之塔", FieldBoss: "區域頭目", Bounty: "通緝", Predator: "狂暴",
    EnemyCamp: "敵人營地", AntiAir: "防空砲塔", Incident: "事件",
  }],
  ["fishing", "釣魚", {
    // 依難度拆開:合併成一類的話,「我要找達人釣場」這種最常見的需求就做不到。
    // 譯名直接用來源的 fishing 命名空間(Easy→初級釣場 … IMPOSSIBLE→極難釣場)。
    FishingSpot: { split: "type", labels: FISHING },
    RareFishingSpot: { split: "type", labels: RARE_FISHING },
    // 打撈只有兩級,來源沒給譯名;它用銀/金兩色環區分,對應普通與稀有。
    Salvage: { split: "type", labels: { Rank1: "打撈", Rank2: "稀有打撈" } },
  }],
  ["location", "地點", {
    FastTravels: "快速傳送", Respawn: "重生", SkylandWarpAltar: "傳送環", Home: "首頁",
    WatchTower: "瞭望塔",
    RegionName: { label: "地區名稱", requireName: true },
    DungeonPortal: { label: "地牢", merge: ["DungeonFixed"] },
    CaveEntrance: "洞穴入口", TreasureMap: "藏寶圖", Quest: "任務",
  }],
  ["mineral", "礦物", {
    OreMetal: "金屬礦石", OreCoal: "石炭", OreQuartz: "純水晶", OreQuartzCluster: "純水晶簇",
    OreSulfur: "硫磺", Chromites: "鉻鐵礦", RainbowCrystal: "六稜晶礦", SkyIslandOre: "烈陽金屬",
    AncientLava: "古代熔岩塊", AncientWood: "古代樹皮",
    AncientBeastBone: "古代獸骨",
  }],
  ["npc", "NPC", {
    NpcSalesPerson: "流浪商人", NpcPalDealer: "帕魯商人", NpcDarkTrader: "黑市商人",
    NpcMedalTrader: "獎章商人", NpcPalDisplay: "帕魯評論家", NpcEmote: "愛的傳教士",
    NpcPresenter: "帕魯馴養師", NpcBountyTrader: "賞金負責人", NpcOther: "其他 NPC",
  }],
  ["oilrig", "石油鑽井平台", {
    // 鑽井平台的寶箱有三種變體(oilrig / oilrigMini / oilrigLarge),獎勵箱有兩種。
    // 只列部分會少算:少了 oilrig 就是 33 而不是 45,少了 oilrigMiniGoal 就是 4 而不是 6。
    // 用「排除獎勵箱」而不是逐一列舉,以後多出新變體才不會又漏掉。
    ChestboxOilrig: {
      src: "Chestbox",
      label: "石油鑽井平台寶箱",
      only: (t) => String(t ?? "").startsWith("oilrig") && !String(t).endsWith("Goal"),
    },
    ChestboxOilrigGoal: {
      src: "Chestbox",
      label: "石油鑽井平台獎勵寶箱",
      only: (t) => String(t ?? "").startsWith("oilrig") && String(t).endsWith("Goal"),
    },
  }],
  ["resource", "資源", {
    ChestboxNormal: { src: "Chestbox", label: "寶箱", only: (t) => !String(t ?? "").startsWith("oilrig") },
    ElementTreasure: "屬性寶箱",
    Supply: "隕石",
    Junk: "殘骸",
    SkillFruits: "技能果實樹",
    Peach: "羈絆寶桃",
    BeautifulFlower: "美麗花朵",
    CrudeOil: "原油",
    NightStone: "夜星砂",
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
  for (const [key, def] of Object.entries(cats)) {
    const spec = typeof def === "string" ? { label: def } : def;
    const srcNames = [spec.src ?? key, ...(spec.merge ?? [])];
    /** 收集這個分類要用的原始點(可能來自多個來源類別) */
    const raw = [];
    for (const n of srcNames) {
      if (Array.isArray(pts[n])) raw.push(...pts[n]);
      else unknown.push(n);
    }
    /** 一筆點 → [x, y, world, 子型別?, 名稱?];回 null 代表這筆不屬於此分類 */
    const toRow = (p) => {
      const loc = p.l ?? p.loc;
      if (!Array.isArray(loc) || loc.length < 2) return null;
      const [sx, sy] = loc;
      const isTree = sx > TREE_X;
      const { x, y } = savToMap(sx, sy);
      let name = null;
      let sub = null;
      for (const f of NAME_FIELDS) {
        if (typeof p[f] !== "string") continue;
        name = resolve(p[f]);
        sub = p[f];
        if (name) break;
      }
      // 組織之塔的名稱藏在 bossType,值長成 EPalBossType::ForestBoss,
      // 但翻譯表 tower 的鍵沒有前綴 —— 不去掉就查不到,提示的第二行會直接
      // 印出原始列舉值(「EPalBossType::ForestBoss」)而不是「帕魯保護團體的高塔」。
      let boss = null;
      if (typeof p.bossType === "string") {
        boss = p.bossType.replace(/^EPalBossType::/, "");
        // 一定要指定 tower 命名空間:GrassBoss 在 npc 表裡是「佐伊」(塔主的名字),
        // 在 tower 表裡才是「雷恩盜獵集團的高塔」。通用 resolve 會先撞到 npc。
        const tower = i18n.tower?.[boss] ?? null;
        if (tower) {
          name = tower;
          sub = sub ?? boss;
          boss = null; // 已經變成可讀名稱,第 7 欄就不用再擺原始值
        }
      }
      // 第 4 欄是高度(公尺)。遊戲的 z 是公分,除以 100 才是玩家看到的「Z 38m」。
      // 早期版本省掉了它,但地牢/寶箱在立體地形上常常上下重疊,沒有高度會找錯層。
      const zM = Math.round((loc[2] ?? 0) / 100);
      // 固定七欄,缺的補空值 —— 早期用「有才 push」的變長格式,結果加一個欄位
      // 就得動到所有取值的索引。等級/首領類型是通緝、區域頭目、NPC 的關鍵資訊,
      // 之前整批被丟掉,提示裡才會只剩一個名字。
      return [
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        isTree ? 1 : 0,
        zM,
        sub ?? "",
        name && name !== sub ? name : "",
        typeof p.lv === "number" ? p.lv : (boss ?? 0),
      ];
    };
    const add = (cat, label, list, requireName = false) => {
      const rows = [];
      let tree = 0;
      for (const p of list) {
        const row = toRow(p);
        if (!row) continue;
        // 「地區名稱」這種以名字為主體的標記,來源翻譯表缺字時會變成空白標記。
        // 沒有名字的地區名對玩家沒有意義,直接不收(來源共 121 筆,其中
        // Darkisland07 沒有譯名,濾掉後正好是參考站顯示的 120)。
        if (requireName && !row[5]) continue;
        if (row[2] === 1) tree++;
        rows.push(row);
      }
      if (!rows.length) return;
      categories[cat] = { label, group: groupKey, count: rows.length, worldTree: tree };
      points[cat] = rows;
      total += rows.length;
    };

    if (spec.split) {
      // 依子型別拆成多個分類
      const keyOf = spec.keyOf ?? ((v) => v);
      const buckets = new Map();
      for (const p of raw) {
        const k = keyOf(p[spec.split]);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p);
      }
      for (const [k, list] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
        const label = spec.labels?.[k];
        if (!label) continue; // 沒定義中文名的子型別不獨立成類(避免冒出代號)
        add(`${key}_${k}`, label, list);
      }
    } else {
      const list = spec.only ? raw.filter((p) => spec.only(p.t ?? p.k ?? p.type)) : raw;
      add(key, spec.label, list, spec.requireName);
    }
  }
}

// ---- 溫度區域 ----
// 它不是「一個點」,而是一塊有範圍的區域(extent = 半寬/半高,單位同世界座標),
// 還帶白天/夜晚的體感溫差。畫成標記完全表達不出來,所以另外輸出成矩形區域,
// 由前端畫成半透明色塊:偏熱紅、偏冷藍、日夜溫差大則黃。
const areas = {};
{
  const rows = [];
  for (const h of pts.HeatArea ?? []) {
    const loc = h.l;
    const ext = h.extent;
    if (!Array.isArray(loc) || !Array.isArray(ext)) continue;
    const c = savToMap(loc[0], loc[1]);
    // savToMap 會把軸對調(地圖 x 來自世界 y),半徑也要跟著換邊
    const halfX = ext[1] / WORLD_SCALE;
    const halfY = ext[0] / WORLD_SCALE;
    rows.push([
      Math.round(c.x * 10) / 10,
      Math.round(c.y * 10) / 10,
      loc[0] > TREE_X ? 1 : 0,
      Math.round(halfX * 10) / 10,
      Math.round(halfY * 10) / 10,
      h.day ?? null,
      h.night ?? null,
    ]);
  }
  if (rows.length) {
    areas.HeatArea = rows;
    // 側欄要能勾選它,所以也登記成一個分類(points 留空,渲染走 areas 那條路)
    categories.HeatArea = { label: "溫度", group: "location", count: rows.length, worldTree: rows.filter((r) => r[2] === 1).length };
    points.HeatArea = [];
    total += rows.length;
  }
  console.log(`溫度區域:${rows.length} 塊`);
}

const out = {
  _comment:
    "互動地圖標記。座標已由世界座標經 savToMap 換算成地圖座標(與玩家/據點同一套)。" +
    "每筆為 [x, y, world(0=主世界,1=世界樹), z(公尺), 子型別, 名稱, 等級或首領類型]。由 tools/fetch-map-points.mjs 產生。",
  version: VER,
  groups: GROUPS.map(([key, name]) => ({
    key,
    name,
    categories: Object.keys(categories).filter((c) => categories[c].group === key),
  })),
  categories,
  points,
  areas,
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
