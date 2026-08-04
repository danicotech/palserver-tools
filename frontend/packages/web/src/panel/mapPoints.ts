import { palInfo } from "./paldex";

// 互動地圖的標記資料:載入、篩選、以及「畫得動」所需的分群。
//
// 資料由 tools/fetch-map-points.mjs 產生(見該檔說明),共 56 類、約 14,000 個標記。
// 一次把一萬多個 Leaflet marker 丟進地圖會直接卡死,所以這裡做兩件事:
//   1. 只畫目前視野內的點
//   2. 依縮放層級把鄰近的點併成一顆「數字圓」,放大才散開
// 兩者都是純計算,沒有額外相依。

/** 一筆標記:[x, y, 世界(0=主/1=世界樹), z(公尺), 子型別, 名稱, 等級或首領類型] */
export type RawPoint = [number, number, number, number, string, string, number | string];

export interface MapCategory {
  label: string;
  group: string;
  count: number;
  worldTree: number;
}

/** 溫度區域:[x, y, world, 半寬, 半高, 白天溫差, 夜晚溫差] */
export type HeatArea = [number, number, number, number, number, number | null, number | null];

export interface MapPointsData {
  version: string;
  areas?: { HeatArea?: HeatArea[] };
  groups: { key: string; name: string; categories: string[] }[];
  categories: Record<string, MapCategory>;
  points: Record<string, RawPoint[]>;
}

let cache: Promise<MapPointsData | null> | null = null;

/** 載入標記資料;沒有這份檔案(沒跑過產生腳本)時回 null,地圖照常運作只是沒有標記。 */
export function loadMapPoints(): Promise<MapPointsData | null> {
  cache ??= fetch("/game-data/map-points.json")
    .then((r) => (r.ok ? (r.json() as Promise<MapPointsData>) : null))
    .catch(() => null);
  return cache;
}

/** 掉落 / 商品項目 */
export interface DetailItem {
  /** 名稱 */ n: string;
  /** 圖示代號 */ i?: string;
  /** 數量 */ q?: string | number;
  /** 機率(0–1) */ r?: number;
  /** 售價 */ p?: number;
  /** 帕魯代號(蛋的孵化清單用;有這個就顯示帕魯頭像而不是道具圖) */ pal?: string;
}

/** 標記的詳細資料(標題、掉落表、商店品項),由 tools/fetch-map-detail.mjs 產生。 */
export interface MapDetail {
  version: string;
  /** 事件種類 */
  incidents: { t: string; c: string; n?: string[]; lv?: [number, number] }[];
  /** 地圖座標 "x,y" → 該生成點會刷出的事件索引。一個點會隨機刷多種事件。 */
  incidentAt: Record<string, number[]>;
  incidentZ: Record<string, number>;
  /** points.json 第 5 欄的 key → 筆記 */
  notes: Record<string, { t: string; c: string; x?: string; z?: number }>;
  missions: Record<string, { t: string; y: string; x?: string; exp?: number; z?: number }>;
  chests: Record<string, { l: string; g: { grade: number; items: DetailItem[] }[] }>;
  /** 地圖座標 "x,y" → 寶箱種類 */
  chestAt: Record<string, string>;
  skillFruit: Record<string, { l: string; g: { el?: string; l: string; items: DetailItem[] }[] }>;
  /** [x, y, z, 種類代號] */
  fruitTrees: [number, number, number, string][];
  /** 地圖座標 "x,y" → 技能果實樹種類 */
  fruitAt: Record<string, string>;
  shops: { l: string; cur?: string; curIcon?: string; items: DetailItem[] }[];
  npc: Record<string, string[]>;
}

/** 面板資料:標題 + 分組的掉落表。由 tools/fetch-map-panel.mjs 產生。 */
export interface MapPanel {
  version: string;
  /** kind → 資料鍵 → 內容 */
  panels: Record<string, Record<string, { t?: string; s?: string; d?: string; g?: { l: string; items: DetailItem[] }[] }>>;
  /** 地圖座標 "x,y" → [kind, 資料鍵]。前端只有座標,靠這層轉成資料鍵。 */
  at: Record<string, [string, string]>;
  /** NPC 商店(沒有座標,靠名稱對應到商人分類) */
  shops?: { id: string; l: string; cur?: string; items: DetailItem[] }[];
}

/** 分類 → 它在 map-panel 裡的 kind。
 *  查表有一格容差,不比對 kind 的話會抓到隔壁「別類」標記的資料 ——
 *  金屬礦石旁邊剛好有個打撈點,礦石就會顯示打撈的掉落表。 */
export function panelKindOf(category: string): string | null {
  if (category.startsWith("FishingSpot") || category.startsWith("RareFishingSpot")) return "fishing";
  if (category.startsWith("Eggs")) return "egg";
  if (category.startsWith("Salvage")) return "salvage";
  if (category.startsWith("Dungeon")) return "dungeon";
  const map: Record<string, string> = {
    LootTower: "lootTower",
    TreasureMap: "treasureMap",
    FieldBoss: "fieldBoss",
    Predator: "predator",
    Bounty: "bounty",
    BossTower: "tower",
    Supply: "supply",
  };
  return map[category] ?? null;
}

let panelCache: Promise<MapPanel | null> | null = null;

/** 載入面板資料;缺檔時回 null,標記照常顯示只是沒有掉落表。 */
export function loadMapPanel(): Promise<MapPanel | null> {
  panelCache ??= fetch("/game-data/map-panel.json")
    .then((r) => (r.ok ? (r.json() as Promise<MapPanel>) : null))
    .catch(() => null);
  return panelCache;
}

let detailCache: Promise<MapDetail | null> | null = null;

/** 載入詳細資料;缺檔時回 null,地圖照常運作只是提示裡沒有名稱與掉落表。 */
export function loadMapDetail(): Promise<MapDetail | null> {
  detailCache ??= fetch("/game-data/map-detail.json")
    .then((r) => (r.ok ? (r.json() as Promise<MapDetail>) : null))
    .catch(() => null);
  return detailCache;
}

/** 詳細資料的座標鍵。必須和產生腳本的 ckey 一致(四捨五入到整數)。 */
export const detailKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;

/** 事件分類的中文名。
 *  用詞照抄遊戲內/參考站的說法(實測面板顯示「戰鬥, 帕魯巢穴, 大量出現, 商人,
 *  獎勵事件, 野外事件」),不要自己另外翻 —— 玩家是拿這些字去對照遊戲的。 */
export const INCIDENT_CATEGORY: Record<string, string> = {
  battle: "戰鬥",
  supply: "補給",
  wild: "野外事件",
  nest: "帕魯巢穴",
  outbreak: "大量出現",
  reward: "獎勵事件",
  merchant: "商人",
};

/** 筆記分類的中文名 */
export const NOTE_CATEGORY: Record<string, string> = {
  boss: "首領筆記",
  castaway: "漂流者手記",
  worldTree: "世界樹筆記",
};

export interface Cluster {
  /** 群心(地圖座標) */
  x: number;
  y: number;
  /** 這一群包含幾個點 */
  n: number;
  /** 這一群的代表點(n === 1 時就是唯一那個);用來取名稱與圖示 */
  point?: RawPoint;
  /** 這一群屬於哪個類別(單一類別群才有;混合群為 undefined) */
  category?: string;
  /** 代表點在該類別資料裡的索引 —— 用來給每個標記一個穩定的序號。
   *  同一類動輒上千個點,沒有編號就無法互相指認(「你說的那個寶箱是哪一個?」)。 */
  index?: number;
}

/**
 * 依目前視野與縮放把點分群。
 *
 * 格子大小取「螢幕上約 44 像素」對應的地圖距離 —— 比這更近的點在畫面上本來就疊在一起,
 * 分開畫沒有意義又拖慢速度。zoom 每加一級,同樣的像素對應到的地圖距離減半。
 */
export function clusterPoints(
  entries: { category: string; points: RawPoint[] }[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  /** 地圖座標 → 螢幕像素的倍率 */
  pixelsPerUnit: number,
  world: 0 | 1,
  /** 回 true 的點不納入分群。用來套用「已收集 / 未收集」這種篩選 ——
   *  必須在分群前就排除,分群後才濾會濾不掉:一個群裡混著已收集與未收集,
   *  只憑代表點無法決定整群的去留(縮小地圖後已收集篩選失效就是這個原因)。
   *  傳索引而不是先過濾陣列,是因為索引就是收集紀錄的身分,過濾會讓它整批位移。 */
  skip?: (category: string, index: number) => boolean,
): Cluster[] {
  const cell = 44 / Math.max(pixelsPerUnit, 1e-6);
  const grid = new Map<
    string,
    { sx: number; sy: number; n: number; first: RawPoint; firstIdx: number; cat: string; mixed: boolean }
  >();
  for (const { category, points } of entries) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p[2] !== world) continue;
      if (skip?.(category, i)) continue;
      const [x, y] = p;
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      const g = grid.get(key);
      if (g) {
        g.sx += x;
        g.sy += y;
        g.n++;
        if (g.cat !== category) g.mixed = true;
      } else {
        grid.set(key, { sx: x, sy: y, n: 1, first: p, firstIdx: i, cat: category, mixed: false });
      }
    }
  }
  const out: Cluster[] = [];
  for (const g of grid.values()) {
    out.push({
      x: g.sx / g.n,
      y: g.sy / g.n,
      n: g.n,
      point: g.first,
      index: g.firstIdx,
      category: g.mixed ? undefined : g.cat,
    });
  }
  return out;
}

/** 每個分組的代表色(分群圓與圖例共用);同組同色,掃視時比較好認。 */
export const GROUP_COLOR: Record<string, string> = {
  location: "#3b82f6", // 藍:地點
  enemy: "#ef4444", // 紅:敵人
  collect: "#a855f7", // 紫:收集品
  egg: "#f59e0b", // 琥珀:蛋
  fishing: "#06b6d4", // 青:釣魚
  mineral: "#94a3b8", // 灰藍:礦物
  npc: "#22c55e", // 綠:NPC
  resource: "#eab308", // 黃:資源
};

/** 每個分組的小圖示(沒有圖檔,直接用符號,體積 0 且各平台一致)。 */
export const GROUP_ICON: Record<string, string> = {
  location: "◆",
  enemy: "✦",
  collect: "★",
  egg: "●",
  fishing: "≈",
  mineral: "▲",
  npc: "☻",
  resource: "■",
};

/**
 * 類別 → 圖示。
 *
 * 全部用「專案裡本來就有的遊戲原生素材」,沒有從外站抓任何圖:
 *   - op.gg 的標記圖示只有 4 個是圖檔,其餘 50 個是它 JS 裡的內嵌 SVG,
 *     照抄等於複製人家的美術,比抓座標資料更敏感。
 *   - 而 public/game-data/items/ 已經有 903 個遊戲物品圖示,礦物、蛋、原油、
 *     夜星砂、古代素材、藏寶圖…幾乎全都對得上,那才是正確的來源。
 * 對不上的(寶箱、釣場、NPC、地點類)留 null,改用分組符號 + 顏色,
 * 不硬湊一個意思不對的圖。
 */
const ITEM = (n: string) => `/game-data/items/T_itemicon_${n}.webp`;
const LANDMARK = (n: string) => `/game-data/landmark-icons/${n}`;
/** 遊戲裡的 NPC 頭像;這 10 張專案原本沒有,由 tools/fetch-map-points.mjs 一併取得。 */
const MAPICON = (n: string) => `/game-data/map-icons/${n}.webp`;

/** NPC 類別 → 頭像。原始值形如 SalesPerson / U_Emote_location_E_02,只取得出類型即可。 */
const NPC_ICON: Record<string, string> = {
  NpcSalesPerson: "SalesPerson",
  NpcPalDealer: "PalDealer",
  NpcDarkTrader: "Male_DarkTrader01",
  NpcBountyTrader: "BountyTrader",
  NpcMedalTrader: "Human",
  NpcPalDisplay: "NPC_PalDisplay_1",
  NpcPresenter: "Female_Presenter01",
  NpcEmote: "Emote_location_A_01",
  NpcOther: "Human",
};

/** 每個類別的專用標記圖(來自地圖站的 markers 圖組,已下載到 game-data/map-icons/)。
 *  這些是「地圖標記語意」的圖示(寶箱、釣場、地牢入口…),遊戲物品圖沒有對應物,
 *  所以這一份優先;蛋與雕像另有更細的子型別圖,由 iconFor 覆寫。 */
const MARKER: Record<string, string> = {
  AncientBeastBone: "BeastBone_Ancient.webp",
  AncientLava: "Lava_Ancient.webp",
  AncientWood: "Wood_Ancient.webp",
  AntiAir: "anti-air.webp",
  BeautifulFlower: "Poppy.webp",
  BossTower: "boss-tower.webp",
  Bounty: "bounty.webp",
  CaveEntrance: "cave-entrance.webp",
  Chestbox: "chest.webp",
  Chromites: "chromite.webp",
  CrudeOil: "crude-oil.webp",
  DungeonFixed: "dungeon.webp",
  DungeonPortal: "dungeon.webp",
  ElementTreasure: "element-chest.webp",
  EnemyCamp: "enemy-camp.webp",
  FastTravels: "fast-travel.webp",
  FieldBoss: "field-boss.webp",
  FishingSpot: "fishing.webp",
  HeatArea: "heat.webp",
  Home: "home.webp",
  Incident: "incident.webp",
  Junk: "junk.webp",
  LifmunkEffigy: "Relic.webp",
  // 古代遺跡有自己的圖示;之前指到 supply.webp,那是隕石的圖。
  LootTower: "loot-tower.webp",
  NightStone: "night-stone.webp",
  Note: "note.webp",
  NpcBountyTrader: "BountyTrader.webp",
  NpcDarkTrader: "Male_DarkTrader01.webp",
  NpcEmote: "Emote_location_A_01.webp",
  NpcMedalTrader: "Human.webp",
  NpcOther: "Human.webp",
  NpcPalDealer: "PalDealer.webp",
  NpcPalDisplay: "NPC_PalDisplay_1.webp",
  NpcPresenter: "Female_Presenter01.webp",
  NpcSalesPerson: "SalesPerson.webp",
  OreCoal: "ore-coal.webp",
  OreMetal: "ore-metal.webp",
  OreQuartz: "ore-quartz.webp",
  OreQuartzCluster: "ore-quartz.webp",
  OreSulfur: "ore-sulfur.webp",
  Peach: "peach.webp",
  Predator: "predator.webp",
  Quest: "quest.webp",
  RainbowCrystal: "rainbow-crystal.webp",
  RareFishingSpot: "fishing.webp",
  RegionName: "region.webp",
  Respawn: "respawn.webp",
  Salvage: "salvage.webp",
  SkillFruits: "skill-fruit.webp",
  SkyIslandOre: "sky-island-ore.webp",
  SkylandWarpAltar: "skyland-warp-altar.webp",
  Supply: "supply.webp",
  TreasureMap: "treasure-map.webp",
  WatchTower: "watch-tower.webp",
  WorldTreeOre: "sky-island-ore.webp"
};

const LEGACY_ICON: Record<string, string | null> = {
  // 地點
  FastTravels: LANDMARK("fasttravel.png"),
  DungeonPortal: LANDMARK("dungeon.png"),
  DungeonFixed: LANDMARK("dungeon.png"),
  BossTower: LANDMARK("tower.png"),
  Home: LANDMARK("palbox.webp"),
  TreasureMap: ITEM("Consume_TreasureMap01"),
  // 礦物 / 素材
  OreCoal: ITEM("Material_Coal"),
  OreSulfur: ITEM("Material_Sulfur"),
  OreQuartz: ITEM("Material_Quartz"),
  OreQuartzCluster: ITEM("Material_Quartz"),
  Chromites: ITEM("Material_Chromium"),
  RainbowCrystal: ITEM("Material_RainbowCrystal"),
  SkyIslandOre: ITEM("Material_SkyIslandOre"),
  OreMetal: ITEM("Material_Stone"),
  WorldTreeOre: ITEM("Material_SkyIslandOre"),
  AncientLava: ITEM("Material_Lava_Ancient"),
  AncientWood: ITEM("Material_Wood_Ancient"),
  AncientBeastBone: ITEM("Material_BeastBone_Ancient"),
  // 資源
  CrudeOil: ITEM("Material_CrudeOil"),
  NightStone: ITEM("Material_NightStone"),
  BeautifulFlower: ITEM("Food_Poppy"),
  // 敵人(這張的檔名前綴不同,直接寫全路徑)
  Bounty: "/game-data/items/T_icon_item_Jewelry_BountyProof_1.webp",
};

/** 翠葉鼠雕像:每種帕魯的雕像長得不一樣,對應 Relic 系列圖。
 *  這 12 張專案裡本來就有(T_itemicon_Relic{,_01.._11}.webp),不必外求;
 *  編號對照取自遊戲資料,並實測比對過同編號圖檔為同一張(平均像素差 8.5/255,
 *  差異來自解析度 140 vs 256 的縮放)。 */
const EFFIGY_RELIC: Record<string, string> = {
  Carbunclo: "Relic", // 翠葉鼠
  SheepBall: "Relic_01", // 棉悠悠
  Penguin: "Relic_02", // 企丸丸
  IceCrocodile: "Relic_03", // 肚肚鱷
  FlameBambi: "Relic_04", // 燎火鹿
  LeafMomonga: "Relic_05", // 達鼠泥
  Monkey: "Relic_06", // 新葉猿
  NegativeKoala: "Relic_07", // 瞅什魔
  PinkCat: "Relic_08", // 搗蛋貓
  Mutant: "Relic_09", // 秘斯媞雅
  LazyDragon: "Relic_10", // 佩克龍
  GuardianDog: "Relic_11", // 八雲犬
};

/** 蛋依子型別給不同顏色的蛋圖(k 例:grass_02 / volcano_01 / worldtree_01)。 */
const EGG_BY_KEY: Record<string, string> = {
  grass: "Leaf_01", desert: "Earth_01", volcano: "Fire_01", snow: "Ice_01",
  sakurajima: "Water_01", skyisland: "Electricity_01", worldtree: "WorldTree_01",
  darkisland: "Dark_01",
};

/** 取得某一筆標記要用的圖示;沒有合適的圖回 null(呼叫端改用分組符號)。 */
/** 拆分後的分類鍵長成 Eggs_grass / LifmunkEffigy_Carbunclo / ChestboxNormal,
 *  圖示對照仍以原始類別為主,這裡把鍵還原並補上拆分專屬的圖。 */
function splitIcon(category: string): string | null {
  if (category.startsWith("Eggs_")) {
    const v = EGG_BY_KEY[category.slice(5)];
    return v ? ITEM(`Material_PalEgg_${v}`) : MAPICON("PalEgg_Normal_01");
  }
  if (category.startsWith("LifmunkEffigy_")) {
    return ITEM(EFFIGY_RELIC[category.slice(14)] ?? "Relic");
  }
  if (category === "ChestboxNormal") return `/game-data/map-icons/chest.webp`;
  if (category.startsWith("ChestboxOilrig")) return `/game-data/map-icons/oilrig-chest.webp`;
  return null;
}

export function iconFor(category: string, sub?: string): string | null {
  const split = splitIcon(category);
  if (split) return split;
  // 蛋、雕像、頭目、NPC 有更精確的子型別圖,先讓下面的規則處理;其餘一律用標記圖。
  // 區域頭目/狂暴:原始值是帕魯代號(BOSS_Horus_Water、PREDATOR_SifuDog),
  // 去掉前綴就能用專案既有的帕魯頭像 —— 直接看到是哪一隻,比一個通用圖示有用得多。
  if (category === "FieldBoss" || category === "Predator") {
    const key = (sub ?? "").replace(/^(BOSS_|PREDATOR_)/, "");
    return key ? palInfo(key.toLowerCase()).iconUrl || null : null;
  }
  if (NPC_ICON[category]) return MAPICON(NPC_ICON[category]);
  if (category === "LifmunkEffigy") {
    return ITEM(EFFIGY_RELIC[sub ?? "Carbunclo"] ?? "Relic");
  }
  if (category === "Eggs") {
    const base = (sub ?? "").split("_")[0].toLowerCase();
    const v = EGG_BY_KEY[base];
    return v ? ITEM(`Material_PalEgg_${v}`) : MAPICON("PalEgg_Normal_01");
  }
  if (MARKER[category]) return `/game-data/map-icons/${MARKER[category]}`;
  // 拆分出來的子類別(FishingSpot_Easy、Salvage_Rank2、RareFishingSpot_Normal…)
  // 沿用母類別的標記圖。少了這一步,所有釣場與打撈都查不到圖而回傳 null,
  // 畫面上就只剩沒有圖的小圓點 —— 圖示表裡只有母類別 FishingSpot / Salvage。
  const base = category.split("_")[0];
  if (base !== category && MARKER[base]) return `/game-data/map-icons/${MARKER[base]}`;
  return LEGACY_ICON[category] ?? null;
}


/** 類別的代表圖示(側欄標籤、分群圓都用它)。
 *  蛋與雕像有很多子型別,取一個最通用的當代表就好。 */
export function categoryIcon(category: string): string | null {
  const split = splitIcon(category);
  if (split) return split;
  if (MARKER[category]) return `/game-data/map-icons/${MARKER[category]}`;
  if (category === "Eggs") return MAPICON("PalEgg_Normal_01");
  if (category === "LifmunkEffigy") return ITEM("Relic");
  if (category === "FieldBoss") return MAPICON("Boss_Anubis");
  if (category === "Predator") return palInfo("sifudog").iconUrl || null;
  return iconFor(category);
}

/** 這個類別要不要用圓形頭像框(NPC 與頭目是人物/生物肖像,方形去背會很怪)。 */
export function isPortrait(category: string): boolean {
  return category.startsWith("Npc") || category === "FieldBoss" || category === "Predator";
}


/** 一筆生成點:[x, y, when(0=白天,1=夜晚,2=全天), 等級下限, 等級上限, world] */
export type SpawnPoint = [number, number, number, number, number, number];
export interface PalSpawns {
  pals: Record<string, SpawnPoint[]>;
}

/** 帕魯出生地(1.4 MB,只有真的要看時才載)。沒有這個檔就回 null,功能自動隱藏。 */
let spawnCache: Promise<PalSpawns | null> | null = null;
export function loadPalSpawns(): Promise<PalSpawns | null> {
  spawnCache ??= fetch("/game-data/pal-spawns.json")
    .then((r) => (r.ok ? (r.json() as Promise<PalSpawns>) : null))
    .catch(() => null);
  return spawnCache;
}

/** 還沒載入棲息地資料時,先給一份帕魯代號清單讓選擇器有東西可顯示。
 *  真正有資料的是哪些,載完之後會自動換成 spawns 的鍵。 */
export const PAL_IDS: string[] = [];


/** 溫度區域的顏色:偏熱紅、偏冷藍、日夜溫差大則黃。
 *  同時看日夜兩個值 —— 只看其中一個會把「白天悶熱、夜晚酷寒」這種區域標錯。 */
export function heatColor(day: number | null, night: number | null): { color: string; label: string } {
  const vals = [day, night].filter((v): v is number => v != null);
  if (!vals.length) return { color: "#9ca3af", label: "—" };
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  if (hi > 0 && lo < 0) return { color: "#eab308", label: "日夜溫差" }; // 黃
  if (hi > 0) return { color: "#ef4444", label: "高溫" }; // 紅
  return { color: "#3b82f6", label: "低溫" }; // 藍
}
