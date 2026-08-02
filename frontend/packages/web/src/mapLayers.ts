import * as L from "leaflet";
import { palIconUrl } from "./gameData";
import { t, type Lang } from "./i18n";

/**
 * 世界地圖底圖常數與靜態圖層(頭目/地標)的單一真相來源。MapTab.tsx(線上地圖)與
 * MapPickModal.tsx(傳送選點)共用這份,確保底圖邊界、圖示樣式兩處永遠一致
 * (過去兩邊各自宣告一份 MAP_IMAGE/IMAGE_BOUNDS,靠註解提醒手動同步,容易漂移)。
 *
 * 傳送選點地圖只需要圖示與位置(不含存活/重生倒數——那需要額外拉 boss-respawns 狀態並配對,
 * 對「選一個座標」這個操作不是必要資訊,故意不做,見兩邊使用方式的差異)。
 */

export const MAP_IMAGE = "/palworld-full-map.jpg";
/** 世界 X∈[-1099400,349400]、Y∈[-724400,724400] 經 savToMap 換算後的地圖座標邊界。 */
export const IMAGE_BOUNDS = L.latLngBounds([-2125.3, -1922.44], [1031.13, 1233.99]);

// ---- 高解析底圖(圖磚金字塔)----
//
// MAP_IMAGE 是單張 4096×4096 的 JPEG:整張放進畫面很清楚,但放大到底就糊掉
// (最高縮放時等於把 4096 拉伸十幾倍)。圖磚版是 z0-z6 的金字塔,
// z6 為 64×64 張 256px = 等效 16384×16384,放大四倍仍然銳利。
//
// 兩者框取範圍完全相同(逐像素比對過,內容外框一致、平均像素差 0.3/255),
// 所以共用同一組 IMAGE_BOUNDS,座標與玩家標記都不必改。
//
// 圖磚檔數多(5461 張)、體積大(約 108 MB),不進版控 ——
// 沒有圖磚的部署會自動退回單張 MAP_IMAGE(見 PlayerMap 的偵測),
// 要啟用就跑 tools/fetch-map-tiles.mjs 把它抓下來。
export const MAP_TILES = "/map-tiles/{z}/{x}/{y}.png";
/** 圖磚金字塔的最深層級(再往上放大就是拉伸 z6 的內容)。 */
export const MAP_TILES_MAXNATIVE = 6;
/** 探測用:有這張就代表圖磚已就緒。 */
export const MAP_TILES_PROBE = "/map-tiles/0/0/0.png";

/**
 * 讓「整張地圖」對應到圖磚金字塔的 CRS。
 *
 * 預設的 CRS.Simple 是 scale(z)=2^z、pixel=(lng,-lat),圖磚要的是
 * 「z 層有 2^z × 2^z 張 256px 圖磚鋪滿整張地圖」。這裡把地圖邊界線性映射到
 * [0, 256·2^z],Leaflet 算出來的圖磚座標才會剛好是 /{z}/{x}/{y}。
 */
const SPAN = IMAGE_BOUNDS.getEast() - IMAGE_BOUNDS.getWest(); // 地圖邊長(正方形)
export const TILE_CRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(
    1 / SPAN,
    -IMAGE_BOUNDS.getWest() / SPAN,
    -1 / SPAN,
    IMAGE_BOUNDS.getNorth() / SPAN,
  ),
  scale: (zoom: number) => 256 * Math.pow(2, zoom),
  zoom: (scale: number) => Math.log(scale / 256) / Math.LN2,
});

/** 圖磚是否已部署(結果快取,只探一次)。 */
let tilesReady: Promise<boolean> | null = null;
export function hasMapTiles(): Promise<boolean> {
  tilesReady ??= fetch(MAP_TILES_PROBE, { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  return tilesReady;
}

export const TREE_MAP_IMAGE = "/worldtree-map.webp";
export const TREE_IMAGE_BOUNDS = L.latLngBounds([-1000, -1000], [1000, 1000]);

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** 多語顯示名(paldb 每語系地圖資料;zh-CN 欄位歷史上有兩種 key 併存,故兩個都試)。 */
export interface LocalizedName {
  en: string;
  zh: string;
  "zh-CN"?: string;
  zhCN?: string;
  ja: string;
}

function localizedLabel(name: LocalizedName, lang: Lang): string {
  return (lang === "zh-CN" ? name["zh-CN"] ?? name.zhCN : name[lang]) || name.en;
}

/** 靜態地標(paldb.cc 的地圖資料;x/y 已經是地圖座標系,不需再經 savToMap)。 */
export interface Landmark {
  type: string;
  name: LocalizedName;
  x: number;
  y: number;
  lv?: number;
}

export const LANDMARK_STYLE: Record<string, { icon: string; size: number; label: string }> = {
  "Fast Travel": { icon: "/game-data/landmark-icons/fasttravel.png", size: 26, label: "快速旅行" },
  Tower: { icon: "/game-data/landmark-icons/tower.png", size: 30, label: "頭目塔" },
  Dungeon: { icon: "/game-data/landmark-icons/dungeon.png", size: 22, label: "地牢" },
};

/** 野外頭目(paldb.cc 的地圖資料;x/y 已經是地圖座標系)。 */
export interface Boss {
  name: LocalizedName;
  x: number;
  y: number;
  lv?: number;
  /** game-data/pals/ 底下的檔名,沒有就不顯示頭目肖像。 */
  icon?: string;
  /** "field"(阿爾法,野外生成)或 "sealed"(封印領域)。缺省視為 field(舊資料相容)。 */
  kind?: "field" | "sealed";
}

export interface MapLayerData {
  landmarks: Landmark[];
  bosses: Boss[];
  treeLandmarks: Landmark[];
  treeBosses: Boss[];
}

/** 抓四份靜態圖層 JSON(主世界/世界樹的地標+頭目)。個別失敗給空陣列,不擋其他圖層。 */
export async function loadMapLayers(): Promise<MapLayerData> {
  const fetchJson = async <T>(path: string): Promise<T[]> => {
    try {
      const res = await fetch(path);
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as T[]) : [];
    } catch {
      return [];
    }
  };
  const [landmarks, bosses, treeLandmarks, treeBosses] = await Promise.all([
    fetchJson<Landmark>("/game-data/landmarks.json"),
    fetchJson<Boss>("/game-data/bosses.json"),
    fetchJson<Landmark>("/game-data/worldtree-landmarks.json"),
    fetchJson<Boss>("/game-data/worldtree-bosses.json"),
  ]);
  return { landmarks, bosses, treeLandmarks, treeBosses };
}

/** 地標 marker(尚未 addTo 地圖);type 不在 LANDMARK_STYLE 裡就回 null(未知類型不畫)。 */
export function buildLandmarkMarker(lm: Landmark, lang: Lang): L.Marker | null {
  const style = LANDMARK_STYLE[lm.type];
  if (!style) return null;
  const icon = L.icon({
    iconUrl: style.icon,
    iconSize: [style.size, style.size],
    iconAnchor: [style.size / 2, style.size / 2],
    className: "pmap-landmark",
  });
  return L.marker([lm.y, lm.x], { icon }).bindTooltip(
    `<div style="font-weight:800">${escapeHtml(localizedLabel(lm.name, lang))}</div>` +
      `<div>${t(style.label)}${lm.lv ? ` · Lv.${lm.lv}` : ""}</div>`,
    { direction: "top", className: "pmap-detail" },
  );
}

/** 頭目 marker(尚未 addTo 地圖)。不含存活/重生狀態——只是圖示與位置,見檔頭說明。 */
export function buildBossMarker(b: Boss, lang: Lang): L.Marker {
  const BS = 36;
  const sealed = b.kind === "sealed";
  const iconUrl = b.icon ? palIconUrl(b.icon) : null;
  const icon = L.divIcon({
    className: "pmap-boss-wrap",
    iconSize: [BS, BS],
    iconAnchor: [BS / 2, BS / 2],
    tooltipAnchor: [0, -BS / 2],
    html:
      `<span class="pmap-boss${sealed ? " pmap-boss-sealed" : ""}" style="width:${BS}px;height:${BS}px">` +
      (iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" />` : "") +
      `<span class="pmap-boss-badge${sealed ? " pmap-boss-badge-sealed" : ""}">` +
      (sealed
        ? `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 2 22 12 12 22 2 12z"/></svg>`
        : `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M4 17l-2-10 5.5 4L12 4l4.5 7L22 7l-2 10z"/></svg>`) +
      `</span>` +
      (b.lv ? `<span class="pmap-boss-lv${sealed ? " pmap-boss-lv-sealed" : ""}">${b.lv}</span>` : "") +
      `</span>`,
  });
  return L.marker([b.y, b.x], { icon, riseOnHover: true }).bindTooltip(
    `<div style="font-weight:800">${escapeHtml(localizedLabel(b.name, lang))}</div>` +
      `<div>${t(sealed ? "封印領域" : "阿爾法")}${b.lv ? ` · Lv.${b.lv}` : ""}</div>`,
    { direction: "top", className: "pmap-detail" },
  );
}
