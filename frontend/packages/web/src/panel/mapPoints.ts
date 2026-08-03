// 互動地圖的標記資料:載入、篩選、以及「畫得動」所需的分群。
//
// 資料由 tools/fetch-map-points.mjs 產生(見該檔說明),共 56 類、約 14,000 個標記。
// 一次把一萬多個 Leaflet marker 丟進地圖會直接卡死,所以這裡做兩件事:
//   1. 只畫目前視野內的點
//   2. 依縮放層級把鄰近的點併成一顆「數字圓」,放大才散開
// 兩者都是純計算,沒有額外相依。

/** 一筆標記:[x, y, 世界(0=主/1=世界樹), 子型別?, 名稱?] */
export type RawPoint = [number, number, number, string?, string?];

export interface MapCategory {
  label: string;
  group: string;
  count: number;
  worldTree: number;
}

export interface MapPointsData {
  version: string;
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

export interface Cluster {
  /** 群心(地圖座標) */
  x: number;
  y: number;
  /** 這一群包含幾個點 */
  n: number;
  /** n === 1 時的那個點,用來顯示名稱 */
  point?: RawPoint;
  /** 這一群屬於哪個類別(單一類別群才有;混合群為 undefined) */
  category?: string;
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
): Cluster[] {
  const cell = 44 / Math.max(pixelsPerUnit, 1e-6);
  const grid = new Map<string, { sx: number; sy: number; n: number; first: RawPoint; cat: string; mixed: boolean }>();
  for (const { category, points } of entries) {
    for (const p of points) {
      if (p[2] !== world) continue;
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
        grid.set(key, { sx: x, sy: y, n: 1, first: p, cat: category, mixed: false });
      }
    }
  }
  const out: Cluster[] = [];
  for (const g of grid.values()) {
    out.push({
      x: g.sx / g.n,
      y: g.sy / g.n,
      n: g.n,
      point: g.n === 1 ? g.first : undefined,
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

export const CATEGORY_ICON: Record<string, string | null> = {
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

/** 蛋依子型別給不同顏色的蛋圖(k 例:grass_02 / volcano_01 / worldtree_01)。 */
const EGG_BY_KEY: Record<string, string> = {
  grass: "Leaf_01", desert: "Earth_01", volcano: "Fire_01", snow: "Ice_01",
  sakura: "Water_01", skyisland: "Electricity_01", worldtree: "WorldTree_01", dark: "Dark_01",
};

/** 取得某一筆標記要用的圖示;沒有合適的圖回 null(呼叫端改用分組符號)。 */
export function iconFor(category: string, sub?: string): string | null {
  if (category === "Eggs") {
    const base = (sub ?? "").split("_")[0].toLowerCase();
    const v = EGG_BY_KEY[base];
    return v ? ITEM(`Material_PalEgg_${v}`) : ITEM("Material_PalEgg");
  }
  return CATEGORY_ICON[category] ?? null;
}
