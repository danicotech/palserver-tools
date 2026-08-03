// 玩家查詢的地圖:全部玩家的最後存檔位置 + 公會據點(Leaflet CRS.Simple)。
// 底圖常數/樣式與管理端地圖共用(mapLayers + styles.css 的 pmap-*),座標經
// shared 的 savToMap/savToWorldTreeMap 換算;世界樹座標的實體只出現在世界樹底圖。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  FiMaximize,
  FiMinimize,
  FiMapPin,
  FiRotateCcw,
  FiChevronLeft,
  FiChevronRight,
  FiFilter,
  FiSearch,
  FiChevronDown,
  FiAlertTriangle,
  FiStar,
  FiAnchor,
  FiTriangle,
  FiUsers,
  FiBox,
  FiCheckSquare,
} from "react-icons/fi";
import { GiEggClutch } from "react-icons/gi";
import type { IconType } from "react-icons";
import {
  loadMapPoints,
  clusterPoints,
  iconFor,
  categoryIcon,
  isPortrait,
  GROUP_COLOR,
  GROUP_ICON,
  loadPalSpawns,
  type MapPointsData,
  PAL_IDS,
  heatColor,
  type PalSpawns,
} from "./mapPoints";
import { savToMap, savToWorldTreeMap, isWorldTreeCoord, guildColorFromId } from "@palserver/shared";
import {
  MAP_IMAGE,
  IMAGE_BOUNDS,
  TREE_MAP_IMAGE,
  TREE_IMAGE_BOUNDS,
  mapTilesUrl,
  MAP_TILES_MAXNATIVE,
  TILE_CRS,
  detectMapTiles,
  escapeHtml,
} from "../mapLayers";
import { usePlayerAvatar, playerInitial } from "./playerAvatar";
import { palInfo } from "./paldex";
import type { Player, Guild } from "./types";
import type { Dataset } from "./data";
import { t, useI18n } from "../i18n";

type World = "main" | "tree";
type WhoFilter = "all" | "online" | "offline" | "none";

/** 分組圖示:一律用 icon 元件,不用幾何符號或 emoji ——
 *  符號在不同字型下大小/基線不一,emoji 各平台長得也不一樣。 */
const GROUP_ICON_CMP: Record<string, IconType> = {
  location: FiMapPin,
  enemy: FiAlertTriangle,
  collect: FiStar,
  egg: GiEggClutch,
  fishing: FiAnchor,
  mineral: FiTriangle,
  npc: FiUsers,
  resource: FiBox,
};

export function PlayerMap({
  data,
  online,
  live,
  onPlayerClick,
}: {
  data: Dataset;
  /** 目前在線的玩家名稱(小寫);用於在線/離線篩選 */
  online: Set<string>;
  /** 在線玩家的即時座標(官方 REST GET /v1/api/players);沒有就退回存檔位置 */
  live?: Map<string, { x: number; y: number }>;
  /** 點玩家頭像 → 跳到該玩家(帶入搜尋)。 */
  onPlayerClick?: (p: Player) => void;
}): JSX.Element | null {
  useI18n();
  // 頭像跟右上角「設定頭像」連動(名冊更新 → 標記重畫)
  const avatarOf = usePlayerAvatar();
  const [world, setWorld] = useState<World>("main");
  const [who, setWho] = useState<WhoFilter>("all");
  const [guildFilter, setGuildFilter] = useState("all");
  const [showBases, setShowBases] = useState(true);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null); // 全螢幕的對象:連同上方篩選列一起放大
  const mapBoxRef = useRef<HTMLDivElement>(null); // 地圖容器的外框(用來把它對齊到整數像素)
  const [isFull, setIsFull] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds>(IMAGE_BOUNDS);
  const markersRef = useRef<L.LayerGroup | null>(null);
  /** key → marker,用於原地更新而不是清空重畫 */
  const markerRegRef = useRef<Map<string, L.Marker>>(new Map());
  const onPlayerClickRef = useRef(onPlayerClick);
  onPlayerClickRef.current = onPlayerClick;

  const isOnline = (p: Player) => online.has(p.name.trim().toLowerCase());

  /** uid → 所屬公會(畫頭像框色與 tooltip 用)。 */
  const guildByUid = useMemo(() => {
    const m = new Map<string, Guild>();
    for (const g of data.guilds) for (const u of g.member_uids) m.set(u, g);
    return m;
  }, [data.guilds]);

  /** 有座標的玩家(0,0 視為沒資料)。 */
  const located = useMemo(
    () => data.players.filter((p) => p.location && (p.location.x !== 0 || p.location.y !== 0)),
    [data.players],
  );

  /** 套用篩選後要畫的玩家。 */
  const shownPlayers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return located.filter((p) => {
      if (who === "none") return false; // 只看標記時把玩家頭像整批關掉
      if (who === "online" && !isOnline(p)) return false;
      if (who === "offline" && isOnline(p)) return false;
      if (guildFilter !== "all" && guildByUid.get(p.uid)?.id !== guildFilter) return false;
      if (s && !p.name.toLowerCase().includes(s) && !p.uid.toLowerCase().includes(s)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, who, guildFilter, q, online, guildByUid]);

  /** 套用篩選後要畫的據點(依公會)。 */
  const shownGuilds = useMemo(
    () => (guildFilter === "all" ? data.guilds : data.guilds.filter((g) => g.id === guildFilter)),
    [data.guilds, guildFilter],
  );
  const baseCount = useMemo(() => shownGuilds.reduce((n, g) => n + g.bases.length, 0), [shownGuilds]);

  // 全螢幕。用瀏覽器原生 Fullscreen API,所以按 ESC 或系統手勢離開時我們也要跟著同步狀態
  // (不能只靠自己的按鈕記錄,不然離開後按鈕還停在「離開全螢幕」)。
  useEffect(() => {
    const onChange = () => {
      setIsFull(document.fullscreenElement === wrapRef.current);
      // 容器尺寸變了,Leaflet 必須重算,否則只會在原本大小的區塊裡畫圖。
      // 順便重新 fit —— 放大之後還停在原本的縮放層級,地圖會縮在角落。
      window.setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        snapToPixel();
        m.invalidateSize();
        m.setMinZoom(m.getBoundsZoom(boundsRef.current) - 1);
        m.fitBounds(boundsRef.current);
      }, 100);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    // Safari 仍只吃有前綴的版本
    const webkit = (el as HTMLDivElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen;
    if (el.requestFullscreen) void el.requestFullscreen();
    else if (webkit) webkit.call(el);
  };

  // 有沒有部署高解析圖磚。CRS 必須在建立地圖時就決定,所以要先探測完才能建圖
  // (同源 HEAD,很快;沒有圖磚就退回原本的單張底圖,畫面照常能用)。
  // 互動地圖標記(快速旅行/地牢/礦物/蛋…)。資料檔不存在時 data 為 null,整段功能自動隱藏。
  const [poi, setPoi] = useState<MapPointsData | null>(null);
  const [onCats, setOnCats] = useState<Set<string>>(new Set());
  const [poiOpen, setPoiOpen] = useState(false);
  /** 收合起來的分組(預設全開) */
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set());
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    let alive = true;
    void loadMapPoints().then((d) => alive && setPoi(d));
    return () => {
      alive = false;
    };
  }, []);

  // 帕魯出生地:選一隻就把牠的生成點畫出來(日/夜可分開看)
  const [spawns, setSpawns] = useState<PalSpawns | null>(null);
  const [spawnPal, setSpawnPal] = useState<string | null>(null);
  const [spawnWhen, setSpawnWhen] = useState<"all" | "day" | "night">("all");
  const [palQ, setPalQ] = useState("");
  const [palFold, setPalFold] = useState(false);
  const spawnLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!poiOpen || spawns) return;
    let alive = true;
    void loadPalSpawns().then((d) => alive && setSpawns(d));
    return () => {
      alive = false;
    };
  }, [poiOpen, spawns]);

  /** 可選的帕魯:有棲息地資料的才列出來(沒資料的點了也是空的)。 */
  const palList = useMemo(() => {
    const ids = spawns ? Object.keys(spawns.pals) : PAL_IDS;
    return ids
      .map((id) => {
        const info = palInfo(id.toLowerCase());
        return { id, zh: info.zh || id, icon: info.iconUrl || "" };
      })
      .sort((a, b) => a.zh.localeCompare(b.zh, "zh-Hant"));
  }, [spawns]);

  /** 已收集的座標(key = `類別:序號`)。存在瀏覽器,每個人各自一份;
   *  不上傳後端 —— 這是個人進度,而網站是公開唯讀的,沒有身分可綁。 */
  const COLLECT_KEY = "palpanel.collected";
  const [collected, setCollected] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLECT_KEY) || "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  });
  /** all = 全部、todo = 只看未收集、done = 只看已收集 */
  const [collectView, setCollectView] = useState<"all" | "todo" | "done">("all");
  const toggleCollected = (id: string) =>
    setCollected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLECT_KEY, JSON.stringify([...next]));
      } catch {
        /* 隱私模式寫不了就只在這次工作階段有效 */
      }
      return next;
    });

  const [gotoX, setGotoX] = useState("");
  const [gotoY, setGotoY] = useState("");
  const pinRef = useRef<L.Marker | null>(null);

  // 鍵盤快捷鍵:T 切換主世界/世界樹、F 全螢幕。
  // 在輸入框裡打字時不能觸發,不然打「f」就整個進全螢幕。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") setWorld((w) => (w === "main" ? "tree" : "main"));
      if (e.key === "f" || e.key === "F") toggleFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tiles, setTiles] = useState<"webp" | "png" | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void detectMapTiles().then((ext) => alive && setTiles(ext));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 把地圖容器對齊到整數像素。
   *
   * 上方篩選列的高度是內容撐出來的,常常是小數(實測 56.875px),地圖容器因此
   * 落在半像素位置。圖磚本身是整數對齊的,但整個容器偏移半像素後,瀏覽器得把
   * 每一張圖磚重新取樣 —— 邊緣取樣被裁在各自的範圍內,交界處算出來的顏色就和
   * 連續影像不同,畫面上看到的就是一格一格的網格線。
   * 把小數部分用 transform 補回去(位移不到 1px,肉眼看不出來)即可根治。
   */
  const snapToPixel = () => {
    const box = mapBoxRef.current;
    if (!box) return;
    box.style.transform = "none"; // 先歸零才量得到真正的位置
    const r = box.getBoundingClientRect();
    const dx = r.left - Math.round(r.left);
    const dy = r.top - Math.round(r.top);
    box.style.transform = dx || dy ? `translate(${-dx}px, ${-dy}px)` : "none";
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current || tiles === undefined) return;
    const map = L.map(el, {
      crs: tiles ? TILE_CRS : L.CRS.Simple,
      attributionControl: false,
      // 只允許整數縮放層級。分數縮放時瀏覽器要把圖磚縮到非整數倍,
      // 每張圖磚的邊緣取樣被裁在自己的範圍內,交界處算出來的顏色就和連續影像不同 ——
      // 畫面上看到的就是一格一格的網格線(實測交界與鄰近像素差最多 3.7/255)。
      // 整數層級時圖磚 1:1 貼上,完全沒有重新取樣,也就沒有接縫。
      // 代價是 fitBounds 後容器會留一圈邊,但底色已是接近海面的 #0d161e,不突兀。
      zoomSnap: 1,
      // 圖磚模式下 zoom 就是圖磚層級,允許超出原生兩級(拉伸 z6,仍比單張底圖清楚)
      maxZoom: tiles ? MAP_TILES_MAXNATIVE + 2 : 4,
    });
    map.setView(IMAGE_BOUNDS.getCenter(), tiles ? 2 : -2);
    // +/- 移到右下角:左上角是「篩選」展開鈕的位置,而且右下本來就是地圖工具的慣例區
    map.zoomControl.setPosition("bottomright");
    // 地圖四周的底色。用接近海面的深藍,底圖沒鋪滿容器時看起來是連續的海,
    // 而不是白色/卡片色的一塊空白。
    el.style.background = "#0d161e";
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // 容器高度由版面決定,首輪可能是 0:用 ResizeObserver 校正 fit 與最小縮放。
    let fitted = false;
    const applySize = () => {
      snapToPixel();
      map.invalidateSize();
      if (map.getSize().y === 0) return;
      map.setMinZoom(map.getBoundsZoom(boundsRef.current) - 1);
      if (!fitted) {
        map.fitBounds(boundsRef.current);
        fitted = true;
      }
    };
    const ro = new ResizeObserver(applySize);
    ro.observe(el);
    applySize();
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, [tiles]);

  // 底圖切換(主世界/世界樹)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = world === "tree" ? TREE_IMAGE_BOUNDS : IMAGE_BOUNDS;
    boundsRef.current = bounds;
    // 主世界:有圖磚就用金字塔(放大不糊),沒有就退回單張底圖。
    // 世界樹目前只有單張圖,維持 imageOverlay。
    const overlay =
      world === "main" && tiles
        ? L.tileLayer(mapTilesUrl(tiles), {
            tileSize: 256,
            minZoom: 0,
            // 超過原生層級就拉伸最深那層,不會變成空白圖磚
            maxNativeZoom: MAP_TILES_MAXNATIVE,
            maxZoom: MAP_TILES_MAXNATIVE + 2,
            bounds,
            noWrap: true,
            keepBuffer: 4,
            className: "pmap-tile",
          }).addTo(map)
        : L.imageOverlay(world === "tree" ? TREE_MAP_IMAGE : MAP_IMAGE, bounds).addTo(map);
    overlay.bringToBack();
    map.setMaxBounds(bounds.pad(0.3));
    if (map.getSize().y > 0) {
      map.setMinZoom(map.getBoundsZoom(bounds) - 1);
      map.fitBounds(bounds);
    }
    return () => {
      map.removeLayer(overlay);
    };
  }, [world, tiles]);

  // 換世界時整批重來:兩個世界的座標系不同,沿用舊 marker 會滑到錯的位置
  useEffect(() => {
    markersRef.current?.clearLayers();
    markerRegRef.current.clear();
  }, [world]);

  // ---- 互動地圖標記(POI)----
  // 一萬多個點不可能全部丟給 Leaflet,所以只畫「視野內」的,而且依縮放把鄰近的點併成
  // 一顆數字圓。地圖一移動/縮放就重算一次 —— 重算是純陣列運算,比維護上萬個 DOM 便宜得多。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    poiLayerRef.current ??= L.layerGroup().addTo(map);
    const layer = poiLayerRef.current;

    const draw = () => {
      layer.clearLayers();
      if (!poi || onCats.size === 0) return;

      // 溫度區域是「一塊範圍」不是點,畫成半透明矩形 + 溫差標籤
      if (onCats.has("HeatArea")) {
        for (const [x, y, w, hx, hy, day, night] of poi.areas?.HeatArea ?? []) {
          if (w !== (world === "tree" ? 1 : 0)) continue;
          const { color, label } = heatColor(day, night);
          const rect = L.rectangle(
            [
              [y - hy, x - hx],
              [y + hy, x + hx],
            ],
            { color, weight: 2, opacity: 0.85, fillColor: color, fillOpacity: 0.18, interactive: true },
          );
          const fmt = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}` : `${v}`);
          rect.bindTooltip(
            `<div style="font-weight:800">${escapeHtml(t(label))}</div>` +
              `<div>${t("白天")} ${fmt(day)} · ${t("夜晚")} ${fmt(night)}</div>` +
              `<div>${t("座標")} X : ${Math.round(x)}, Y : ${Math.round(y)}</div>`,
            { direction: "top", className: "pmap-detail", sticky: true },
          );
          rect.addTo(layer);
        }
      }
      const b = map.getBounds();
      // 每個地圖單位佔幾個螢幕像素。
      // 先前是拿地圖中心 + 100 單位去投影,但超過原生圖磚層級(z>6)之後,
      // 那個「中心 +100」的點會落到投影範圍外,算出來的比例失真,
      // 導致 cell 大到把整批點併成看不見的一群 —— 放到最大時標記全消失就是這樣來的。
      // 改成反過來:從容器上兩個實際像素點換回地圖座標,永遠落在有效範圍內。
      const c1 = map.containerPointToLatLng(L.point(0, 0));
      const c2 = map.containerPointToLatLng(L.point(100, 0));
      const pixelsPerUnit = 100 / Math.max(Math.abs(c2.lng - c1.lng), 1e-9);

      const entries = [...onCats]
        .filter((c) => poi.points[c])
        .map((c) => ({ category: c, points: poi.points[c] }));
      const clusters = clusterPoints(
        entries,
        // 外擴一點:剛好落在邊界上的標記不該因為四捨五入被裁掉
        {
          minX: Math.min(b.getWest(), b.getEast()) - 20,
          maxX: Math.max(b.getWest(), b.getEast()) + 20,
          minY: Math.min(b.getSouth(), b.getNorth()) - 20,
          maxY: Math.max(b.getSouth(), b.getNorth()) + 20,
        },
        pixelsPerUnit,
        world === "tree" ? 1 : 0,
      );
      clusters.forEach((c) => {
        const cat = c.category ? poi.categories[c.category] : undefined;
        const color = cat ? (GROUP_COLOR[cat.group] ?? "#64748b") : "#64748b";
        const icon = cat ? (GROUP_ICON[cat.group] ?? "◆") : "◆";
        const sub = c.point?.[4];
        const zM = c.point?.[3] ?? 0;
        // 有對得上的遊戲物品圖就用圖,沒有才退回分組符號 —— 圖比符號好認得多
        const url = c.category ? iconFor(c.category, sub) : null;
        // NPC / 頭目是人物肖像,方形去背會很怪,套圓框才像頭像
        const portrait = c.category ? isPortrait(c.category) : false;
        if (c.n === 1 && c.point) {
          const [, , , , , name, lv] = c.point;
          // 收集品才做「已收集」記號 —— 礦石、寶箱會重生,勾了也沒意義
          const collectable = c.category ? poi.categories[c.category]?.group === "collect" : false;
          const cid = c.category ? `${c.category}:${c.index ?? 0}` : "";
          const done = collectable && collected.has(cid);
          if (collectable && collectView !== "all" && (collectView === "done") !== done) return;
          // 釣場/打撈做成圓框:稀有的把圓填滿分組色,一般的維持深底 ——
          // 同一個圖示重複幾百次,靠「填不填色」比再換一張圖好分辨。
          const ring = c.category?.startsWith("FishingSpot") || c.category?.startsWith("Salvage_Rank1");
          const ringRare = c.category?.startsWith("RareFishingSpot") || c.category === "Salvage_Rank2";
          const cls =
            (url ? (portrait ? "pmap-poi pmap-poi-img pmap-poi-face" : "pmap-poi pmap-poi-img") : "pmap-poi") +
            (ring || ringRare ? " pmap-poi-ring" : "") +
            (ringRare ? " pmap-poi-rare" : "") +
            (done ? " pmap-poi-done" : "");
          const m = L.marker([c.y, c.x], {
            icon: L.divIcon({
              className: cls,
              // 有圖的放大到 34px:原本 24px 的圖太小,遊戲物品圖的辨識度就沒了
              iconSize: url ? [42, 42] : [24, 24],
              iconAnchor: url ? [21, 21] : [12, 12],
              html: url
                ? `<span style="border-color:${color};--poi:${color}"><img src="${escapeHtml(url)}" alt="" loading="lazy" />${
                    done ? `<i></i>` : ""
                  }</span>`
                : `<span style="background:${color}">${icon}</span>`,
            }),
          });
          if (collectable) {
            m.on("click", () => toggleCollected(cid));
          }
          // 標題掛上序號:同一類有上千個點,沒有編號就無法互相指認
          // (「你說的那個寶箱是哪一個?」)。序號是該類別在資料裡的固定順序,重整也不會變。
          // 第一行放「類別 + 序號」(這是拿來互相指認的東西),第二行才是該點的專屬名稱。
          // 原始代號(Volcano_UnderGroundCave_002 之類)不顯示 —— 那是資料內部的鍵,
          // 對玩家沒有意義,只會把提示撐長。
          const seq = c.point ? (c.index ?? 0) + 1 : 0;
          const head = `${cat?.label ?? name ?? ""}${seq ? ` ${seq}` : ""}`;
          m.bindTooltip(
            `<div style="font-weight:800">${escapeHtml(head)}</div>` +
              (name && name !== cat?.label ? `<div>${escapeHtml(name)}</div>` : "") +
              (typeof lv === "number" && lv > 0 ? `<div>Lv ${lv}</div>` : "") +
              (typeof lv === "string" && lv ? `<div>${escapeHtml(lv)}</div>` : "") +
              `<div>${t("座標")} X : ${Math.round(c.x)}, Y : ${Math.round(c.y)}, Z : ${zM}m</div>`,
            { direction: "top", className: "pmap-detail" },
          );
          m.addTo(layer);
        } else {
          // 分群不再畫成「數字圓」——那樣看不出這一堆是什麼東西。
          // 改成「標記圖本身 + 右上角數量徽章」,縮小時仍然一眼認得出是蛋還是礦。
          const m = L.marker([c.y, c.x], {
            icon: L.divIcon({
              className: url
                ? `pmap-poi pmap-poi-img pmap-poi-group${portrait ? " pmap-poi-face" : ""}`
                : "pmap-poi-cluster",
              iconSize: [42, 42],
              iconAnchor: [21, 21],
              html: url
                ? `<span style="border-color:${color}"><img src="${escapeHtml(url)}" alt="" loading="lazy" />` +
                  `<b style="background:${color}">${c.n > 999 ? "999+" : c.n}</b></span>`
                : `<span style="background:${color};width:28px;height:28px">${c.n}</span>`,
            }),
          });
          m.bindTooltip(
            `<div style="font-weight:800">${escapeHtml(cat?.label ?? t("多個標記"))} × ${c.n}</div>` +
              `<div>${t("座標")} X : ${Math.round(c.x)}, Y : ${Math.round(c.y)}, Z : ${c.point?.[3] ?? 0}m</div>` +
              `<div style="opacity:.7">${t("點擊放大展開")}</div>`,
            { direction: "top", className: "pmap-detail" },
          );
          // 點群集就放大過去,跟一般地圖的操作直覺一致
          m.on("click", () => map.setView([c.y, c.x], Math.min(map.getZoom() + 2, map.getMaxZoom())));
          m.addTo(layer);
        }
      });
    };

    draw();
    map.on("moveend zoomend", draw);
    return () => {
      map.off("moveend zoomend", draw);
      layer.clearLayers();
    };
  }, [poi, onCats, world, tiles, collected, collectView]);

  // ---- 帕魯出生地 ----
  // 一隻帕魯最多幾百個生成點,不需要分群,但仍只畫視野內的,縮到很小時才不會卡。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    spawnLayerRef.current ??= L.layerGroup().addTo(map);
    const layer = spawnLayerRef.current;
    const draw = () => {
      layer.clearLayers();
      const list = spawnPal && spawns?.pals[spawnPal];
      if (!list) return;
      const info = palInfo(spawnPal.toLowerCase());
      const b = map.getBounds();
      const w = world === "tree" ? 1 : 0;
      list.forEach(([x, y, when, lvMin, lvMax, tree], idx) => {
        if (tree !== w) return;
        if (spawnWhen === "day" && when === 1) return;
        if (spawnWhen === "night" && when === 0) return;
        if (x < b.getWest() || x > b.getEast() || y < b.getSouth() || y > b.getNorth()) return;
        const m = L.marker([y, x], {
          icon: L.divIcon({
            className: "pmap-spawn",
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            html: info.iconUrl
              ? `<span class="${when === 1 ? "night" : when === 0 ? "day" : ""}"><img src="${escapeHtml(info.iconUrl)}" alt="" loading="lazy" /></span>`
              : `<span></span>`,
          }),
        });
        m.bindTooltip(
          `<div style="font-weight:800">${escapeHtml(info.zh || spawnPal)} ${idx + 1}</div>` +
            `<div>Lv ${lvMin}${lvMax !== lvMin ? `~${lvMax}` : ""} · ${
              when === 2 ? t("全天") : when === 1 ? t("夜晚") : t("白天")
            }</div>` +
            `<div>${t("座標")} X : ${Math.round(x)}, Y : ${Math.round(y)}</div>`,
          { direction: "top", className: "pmap-detail" },
        );
        m.addTo(layer);
      });
    };
    draw();
    map.on("moveend zoomend", draw);
    return () => {
      map.off("moveend zoomend", draw);
      layer.clearLayers();
    };
  }, [spawns, spawnPal, spawnWhen, world]);

  // 標記:據點在下、玩家在上。
  // 重點:更新時「不清空重畫」,而是沿用既有 marker 用 setLatLng 移動,
  // 配合 CSS transition 就會看起來像玩家在地圖上走動,而不是整張圖閃一下。
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    const alive = new Set<string>();
    const reg = markerRegRef.current;
    /** 取得(或建立)某個 key 的 marker */
    const upsert = (key: string, latlng: L.LatLngExpression, icon: L.DivIcon, tip: string, onClick?: () => void) => {
      alive.add(key);
      const existing = reg.get(key);
      if (existing) {
        existing.setLatLng(latlng);
        existing.setIcon(icon);
        existing.setTooltipContent(tip);
        return existing;
      }
      const m = L.marker(latlng, { icon, riseOnHover: true }).bindTooltip(tip, {
        direction: "top",
        className: "pmap-detail",
      });
      if (onClick) m.on("click", onClick);
      m.addTo(group);
      reg.set(key, m);
      return m;
    };
    const project = (sx: number, sy: number): { x: number; y: number } | null => {
      if (isWorldTreeCoord(sx) !== (world === "tree")) return null;
      return world === "tree" ? savToWorldTreeMap(sx, sy) : savToMap(sx, sy);
    };
    /** tooltip 用的座標字串(與遊戲內地圖顯示同一套)。
     *  寫成「X : 123, Y : -456」而不是「123, -456」—— 光兩個數字看不出誰是誰,
     *  而且要拿去輸入定位框時也才對得上欄位。 */
    const coord = (pos: { x: number; y: number }) => `X : ${Math.round(pos.x)}, Y : ${Math.round(pos.y)}`;

    if (showBases) {
      for (const g of shownGuilds) {
        const color = guildColorFromId(g.id);
        g.bases.forEach((b, i) => {
          const pos = project(b.x, b.y);
          if (!pos) return;
          const icon = L.divIcon({
            className: "pmap-base-wrap",
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            tooltipAnchor: [0, -16],
            html: `<span class="pmap-base" style="color:${color}"><img src="/game-data/landmark-icons/palbox.webp" alt="" /></span>`,
          });
          upsert(
            `base:${g.id}:${i}`,
            [pos.y, pos.x],
            icon,
            `<div style="font-weight:800">${escapeHtml(g.name || t("無名公會"))} · ${t("據點")} ${i + 1}/${g.bases.length}</div>` +
              `<div>Lv.${g.level} · ${t("{n} 名成員", { n: g.member_uids.length })}</div>` +
              `<div>${t("座標")} ${coord(pos)}</div>`,
          );
        });
      }
    }

    const SIZE = 40;
    for (const p of shownPlayers) {
      // 存檔的 location 是「最後傳送點」,只有存檔寫入時才更新;
      // 在線玩家改用官方 REST 的即時座標(同一個世界座標系,可直接投影)。
      const now = live?.get((p.name || "").trim().toLowerCase());
      const src = now ?? p.location;
      const pos = project(src.x, src.y);
      if (!pos) continue;
      // 頭像與玩家列表/總覽用同一份規則,幾邊才會長一樣
      const iconUrl = avatarOf(p);
      const guild = guildByUid.get(p.uid);
      const ring = guild ? guildColorFromId(guild.id) : "#ffffff";
      const on = isOnline(p);
      const icon = L.divIcon({
        className: "pmap-avatar-wrap",
        iconSize: [SIZE, SIZE],
        iconAnchor: [SIZE / 2, SIZE / 2],
        tooltipAnchor: [0, -SIZE / 2],
        html:
          `<span class="pmap-avatar${on ? "" : " pmap-offline"}" style="width:${SIZE}px;height:${SIZE}px;border-color:${ring}">` +
          (iconUrl
            ? `<img src="${escapeHtml(iconUrl)}" alt="" />`
            : `<b style="font-size:16px">${escapeHtml(playerInitial(p))}</b>`) +
          `</span>`,
      });
      upsert(
        `player:${p.uid}`,
        [pos.y, pos.x],
        icon,
        `<div style="font-weight:800">${escapeHtml(p.name || "—")}${on ? ` · ${t("在線")}` : ""}</div>` +
          (guild ? `<div style="color:${ring}">${escapeHtml(guild.name || t("無名公會"))}</div>` : "") +
          `<div>Lv.${p.level} · ${t("{n} 隻帕魯", { n: p.pal_count })}</div>` +
          `<div>${t("座標")} ${coord(pos)} <span style="opacity:.75">${
            now ? t("(即時)") : t("(存檔最後位置)")
          }</span></div>`,
        () => onPlayerClickRef.current?.(p),
      );
    }

    // 這輪沒出現的(被篩掉、換世界、離開)才移除
    for (const [key, m] of reg) {
      if (!alive.has(key)) {
        group.removeLayer(m);
        reg.delete(key);
      }
    }
  }, [shownPlayers, shownGuilds, showBases, guildByUid, world, online, avatarOf, live]);

  if (!located.length && !data.guilds.length) return null;

  const btn = (active: boolean) =>
    `min-h-8 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition ${
      active ? "bg-pal text-white" : "text-ink hover:bg-card"
    }`;

  return (
    <div
      ref={wrapRef}
      className={`overflow-hidden bg-card ${
        isFull ? "flex h-screen w-screen flex-col" : "mt-4 rounded-cute ring-1 ring-line"
      }`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink"><FiMapPin size={14} aria-hidden="true" />{t("玩家地圖")}</span>
        <span className="text-xs text-ink-muted">
          {t("{n} 位玩家", { n: shownPlayers.length })} · {t("{n} 個據點", { n: baseCount })}
        </span>

        {/* 在線 / 離線 */}
        <div className="flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
          {(
            [
              ["all", t("全部")],
              ["online", t("在線")],
              ["offline", t("離線")],
              ["none", t("不顯示")],
            ] as [WhoFilter, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setWho(k)} className={btn(who === k)}>
              {label}
            </button>
          ))}
        </div>

        {/* 公會/據點歸屬 */}
        <select
          value={guildFilter}
          onChange={(e) => setGuildFilter(e.target.value)}
          className="min-h-8 rounded-lg bg-card-soft px-2 text-xs text-ink ring-1 ring-line"
        >
          <option value="all">
            {t("全部公會據點")}({data.guilds.reduce((n, g) => n + g.bases.length, 0)})
          </option>
          {[...data.guilds]
            .sort((a, b) => b.bases.length - a.bases.length)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || t("無名公會")}({t("{n} 個據點", { n: g.bases.length })})
              </option>
            ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink">
          <input type="checkbox" checked={showBases} onChange={(e) => setShowBases(e.target.checked)} />
          {t("顯示據點")}
        </label>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("在地圖上找玩家…")}
          className="min-h-8 min-w-36 flex-1 rounded-lg bg-card-soft px-2.5 text-xs text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal"
        />

        {/* 主世界 / 世界樹:常駐切換 */}
        <div className="ml-auto flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
          {(
            [
              ["main", t("主世界")],
              ["tree", t("世界樹")],
            ] as [World, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setWorld(k)} className={btn(world === k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* 地圖區:桌機為「側欄 + 地圖」兩欄,側欄可收合(手機則側欄佔滿寬度疊在上方)。
          原本把篩選做成橫幅接在上面,一展開就把地圖整個往下推,而且分類多的時候
          橫幅比地圖還高 —— 側欄才是這種「多分類 + 大地圖」的正確版型。 */}
      <div className={`flex min-h-0 flex-col sm:flex-row ${isFull ? "flex-1" : ""}`}>
      {poi && poiOpen && (
        <div className={`flex shrink-0 flex-col border-t border-line bg-card-soft/60 sm:w-96 sm:border-t-0 sm:border-r ${
            isFull ? "max-h-64 sm:max-h-none" : "max-h-64 sm:max-h-170"
          }`}>
          {/* 工具列固定在最上方 —— 分類很長,擺下面等於要一路捲到底才按得到 */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setOnCats(new Set());
                setSpawnPal(null);
                setPalQ("");
              }}
              className="flex items-center gap-1.5 rounded-lg bg-pal px-2.5 py-1.5 font-medium text-white transition hover:opacity-90"
            >
              <FiRotateCcw size={13} aria-hidden="true" />
              {t("重置篩選")}
            </button>
            {/* 統計做成 tag 而不是一行灰字 —— 它是「目前狀態」,和旁邊兩顆按鈕同一層級 */}
            <span className="min-w-0 flex-1">
              {onCats.size > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pal/15 px-2 py-1 text-[11px] font-medium text-pal ring-1 ring-pal/30">
                  <FiMapPin size={11} aria-hidden="true" />
                  {t("{n} 個標記", { n: [...onCats].reduce((a, c) => a + (poi.categories[c]?.count ?? 0), 0) })}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-card px-2 py-1 text-[11px] text-ink-muted ring-1 ring-line">
                  {t("尚未選擇")}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setPoiOpen(false)}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-ink-muted transition hover:bg-card hover:text-ink"
            >
              <FiChevronLeft size={13} aria-hidden="true" />
              {t("隱藏篩選")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {poi.groups.map((g) => {
            const cats = g.categories.filter((c) => poi.categories[c]);
            const on = cats.filter((c) => onCats.has(c)).length;
            const folded = foldedGroups.has(g.key);
            const GroupIcon = GROUP_ICON_CMP[g.key] ?? FiMapPin;
            const toggleGroup = () =>
              setOnCats((prev) => {
                const next = new Set(prev);
                if (on === cats.length) cats.forEach((c) => next.delete(c));
                else cats.forEach((c) => next.add(c));
                return next;
              });
            return (
              <div key={g.key} className="mb-2">
                {/* 組標題自成一列(側欄只有 288px,再左右分欄會把分類擠成兩三個字) */}
                <div className="mb-1 flex w-full items-center gap-1">
                  {/* 箭頭只管摺疊,名稱只管全選 —— 兩個動作分開,才不會想收合卻把整組打開 */}
                  <button
                    type="button"
                    onClick={() =>
                      setFoldedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    aria-label={folded ? t("展開") : t("收合")}
                    aria-expanded={!folded}
                    className="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted transition hover:bg-card hover:text-ink"
                  >
                    <FiChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`transition-transform ${folded ? "-rotate-90" : ""}`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={toggleGroup}
                    className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-sm font-bold transition hover:bg-card ${
                      on ? "text-ink" : "text-ink-muted"
                    }`}
                    style={on ? { color: GROUP_COLOR[g.key] } : undefined}
                    title={on === cats.length ? t("全部取消") : t("全部選取")}
                  >
                    <GroupIcon size={16} aria-hidden="true" />
                    <span className="truncate">{g.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] font-medium text-ink-muted">
                      {on ? `${on}/${cats.length}` : t("全部")}
                    </span>
                  </button>
                </div>
                <div className={`grid grid-cols-2 gap-1 ${folded ? "hidden" : ""}`}>
                  {cats.map((c) => {
                    const info = poi.categories[c];
                    const active = onCats.has(c);
                    const catIcon = categoryIcon(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setOnCats((prev) => {
                            const next = new Set(prev);
                            if (next.has(c)) next.delete(c);
                            else next.add(c);
                            return next;
                          })
                        }
                        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs ring-1 transition ${
                          active
                            ? "text-white ring-transparent"
                            : "bg-card text-ink ring-line hover:bg-card-soft hover:ring-pal/50"
                        }`}
                        style={active ? { background: GROUP_COLOR[g.key] } : undefined}
                      >
                        {/* 圖示放大到與文字同級(20px):16px 在深色底上細節全糊掉,認不出是什麼 */}
                        {catIcon ? (
                          <img src={catIcon} alt="" className="size-6 shrink-0 object-contain" loading="lazy" />
                        ) : (
                          <GroupIcon size={20} className="shrink-0" aria-hidden="true" />
                        )}
                        {/* 名稱佔滿中間、數量靠右對齊 —— 兩欄網格加上右對齊的數字,
                            視線才有固定的掃描線,不會像自動換行那樣參差不齊 */}
                        <span className="min-w-0 flex-1 truncate">{info.label}</span>
                        <span
                          className={`shrink-0 text-xs font-medium tabular-nums ${
                            active ? "text-white/75" : "text-ink-muted"
                          }`}
                        >
                          {info.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* 收集進度:只影響「收集品」那一組 */}
          <div className="mt-2 border-t border-line pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
              <FiCheckSquare size={13} aria-hidden="true" />
              {t("收集進度")}
              <span className="ml-auto font-medium tabular-nums">{collected.size}</span>
            </div>
            <div className="flex rounded-lg bg-card p-0.5 text-[11px] ring-1 ring-line">
              {(["all", "todo", "done"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCollectView(k)}
                  className={`flex-1 rounded px-1 py-1 ${collectView === k ? "bg-pal text-white" : "text-ink-muted"}`}
                >
                  {k === "all" ? t("全部") : k === "todo" ? t("未收集") : t("已收集")}
                </button>
              ))}
            </div>
            {collected.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCollected(new Set());
                  try {
                    localStorage.removeItem(COLLECT_KEY);
                  } catch {
                    /* 忽略 */
                  }
                }}
                className="mt-1.5 text-[11px] text-berry underline underline-offset-2"
              >
                {t("清除收集紀錄")}
              </button>
            )}
            <p className="mt-1 text-[10px] leading-tight text-ink-muted">
              {t("點地圖上的收集品即可標記;紀錄存在這台裝置的瀏覽器。")}
            </p>
          </div>

          {/* 帕魯位置:選一隻就在地圖上標出牠的生成點 */}
          <div className="mt-3 border-t border-line pt-2">
            <div className="mb-1.5 flex items-center gap-1 text-sm font-bold text-ink-muted">
              <button
                type="button"
                onClick={() => setPalFold((v) => !v)}
                aria-label={palFold ? t("展開") : t("收合")}
                aria-expanded={!palFold}
                className="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted transition hover:bg-card hover:text-ink"
              >
                <FiChevronDown size={16} aria-hidden="true" className={`transition-transform ${palFold ? "-rotate-90" : ""}`} />
              </button>
              <FiSearch size={15} aria-hidden="true" />
              {t("帕魯位置")}
              {spawnPal && (
                <button type="button" onClick={() => setSpawnPal(null)} className="ml-auto text-berry underline">
                  {t("清除")}
                </button>
              )}
            </div>
            {spawnPal && (
              <div className="mb-1.5 flex rounded-lg bg-card p-0.5 text-[11px] ring-1 ring-line">
                {(["all", "day", "night"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSpawnWhen(k)}
                    className={`flex-1 rounded px-1 py-1 ${spawnWhen === k ? "bg-pal text-white" : "text-ink-muted"}`}
                  >
                    {k === "all" ? t("全天") : k === "day" ? t("白天") : t("夜晚")}
                  </button>
                ))}
              </div>
            )}
            <input
              value={palQ}
              onChange={(e) => setPalQ(e.target.value)}
              placeholder={t("依名稱搜尋帕魯…")}
              hidden={palFold}
              className="mb-1.5 w-full rounded-lg bg-card px-2 py-1.5 text-xs text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal"
            />
            <div className={`max-h-56 grid-cols-4 gap-1 overflow-y-auto ${palFold ? "hidden" : "grid"}`}>
              {palList
                .filter((x) => !palQ.trim() || x.zh.includes(palQ.trim()) || x.id.toLowerCase().includes(palQ.trim().toLowerCase()))
                .slice(0, 200)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setSpawnPal(spawnPal === x.id ? null : x.id)}
                    title={x.zh}
                    className={`flex flex-col items-center gap-0.5 rounded-lg p-1 ring-1 transition ${
                      spawnPal === x.id ? "bg-pal/20 ring-pal" : "bg-card ring-line hover:ring-pal/50"
                    }`}
                  >
                    {x.icon && <img src={x.icon} alt="" className="pmap-pal-pick size-8 object-contain" loading="lazy" />}
                    <span className="w-full truncate text-center text-[10px] text-ink">{x.zh}</span>
                  </button>
                ))}
            </div>
          </div>

          </div>
        </div>
      )}

      {/* 高度變化一律做在「外層」,地圖容器的 className 必須從頭到尾固定不變。
          原因:L.map() 會直接在這個 DOM 元素上加 leaflet-container / leaflet-touch 等 class,
          而 React 只要重繪就會用自己的 className 整個覆蓋掉,把那些 class 洗掉。
          少了 .leaflet-container,Leaflet 的 CSS(含 img.leaflet-image-layer 的 max-width:none)
          全部失效,底圖寬度被 preflight 的 img{max-width:100%} 壓成 0 —— 症狀就是「進全螢幕後地圖不見了」。 */}
      <div ref={mapBoxRef} className={`relative min-w-0 flex-1 ${isFull ? "min-h-0" : "h-80 sm:h-170"}`}>
        <div ref={containerRef} className="size-full" />
        {/* 收合時:地圖左上角一顆展開鈕(op.gg 的作法,地圖不會被側欄吃掉寬度) */}
        {poi && !poiOpen && (
          <button
            type="button"
            onClick={() => setPoiOpen(true)}
            /* 這顆鈕是疊在地圖上的,不能只看它在頁面裡好不好看:
               整片實心品牌藍太搶眼、又和底下的水域同色系,反而不好認。
               改用與 tooltip 同一套「卡片底 + 主文字色 + 半透明模糊」——
               淺色模式是白底深字、深色模式是深底淺字,兩種都跟地圖有明確對比,
               識別色只留在圖示上,尺寸也收斂一級。 */
            className="pmap-filter-btn absolute top-3 left-3 z-1001 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold shadow-cute transition hover:brightness-110"
          >
            <FiFilter size={14} className="text-pal" aria-hidden="true" />
            {t("地圖篩選")}
            {onCats.size > 0 && (
              <span className="rounded-full bg-pal px-1.5 text-[11px] font-bold text-white">{onCats.size}</span>
            )}
            <FiChevronRight size={14} className="opacity-60" aria-hidden="true" />
          </button>
        )}

        {/* 選了帕魯 → 右上角圖例,說明點的顏色代表什麼時段 */}
        {spawnPal && (
          <div className="absolute top-15 right-3 z-1001 rounded-lg bg-card/95 px-3 py-2 text-xs shadow-cute ring-1 ring-line backdrop-blur">
            <div className="mb-1 flex items-center gap-1.5 font-bold text-ink">
              {palInfo(spawnPal.toLowerCase()).iconUrl && (
                <img src={palInfo(spawnPal.toLowerCase()).iconUrl} alt="" className="size-5 object-contain" />
              )}
              {palInfo(spawnPal.toLowerCase()).zh || spawnPal}
            </div>
            {([["全天", "#9ca3af"], ["白天", "#f59e0b"], ["夜晚", "#6366f1"]] as [string, string][]).map(([k, c]) => (
              <div key={k} className="flex items-center gap-1.5 text-ink-muted">
                <span className="size-2.5 rounded-full" style={{ background: c }} />
                {t(k)}
              </div>
            ))}
          </div>
        )}

        {/* 座標定位:輸入 X / Y 直接把鏡頭移過去並放大 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const map = mapRef.current;
            const x = Number(gotoX);
            const y = Number(gotoY);
            if (!map || !Number.isFinite(x) || !Number.isFinite(y)) return;
            map.setView([y, x], Math.max(map.getZoom(), map.getMaxZoom() - 2));
            // 丟一個暫時的定位標記,不然放大後不知道到底指到哪
            pinRef.current?.remove();
            pinRef.current = L.marker([y, x], {
              icon: L.divIcon({ className: "pmap-pin", iconSize: [26, 26], iconAnchor: [13, 13], html: "<span></span>" }),
            }).addTo(map);
          }}
          className="absolute right-3 bottom-3 z-1001 flex items-center gap-1 rounded-lg bg-card/95 px-2 py-1.5 text-xs shadow-cute ring-1 ring-line backdrop-blur"
        >
          <span className="font-bold text-ink-muted">X / Y</span>
          <input
            value={gotoX}
            onChange={(e) => setGotoX(e.target.value)}
            placeholder="X"
            inputMode="numeric"
            className="w-16 rounded bg-card-soft px-1.5 py-1 text-ink ring-1 ring-line outline-none focus:ring-pal"
          />
          <input
            value={gotoY}
            onChange={(e) => setGotoY(e.target.value)}
            placeholder="Y"
            inputMode="numeric"
            className="w-16 rounded bg-card-soft px-1.5 py-1 text-ink ring-1 ring-line outline-none focus:ring-pal"
          />
          <button type="submit" aria-label={t("移到此座標")} title={t("移到此座標")}
            className="flex size-7 items-center justify-center rounded-full bg-pal text-white transition hover:opacity-90">
            <FiMapPin size={14} />
          </button>
        </form>

        {/* 鍵盤提示:與 op.gg 一致,T 換地圖、F 全螢幕 */}
        <div className="absolute bottom-3 left-3 z-1001 hidden rounded-lg bg-card/90 px-2.5 py-1.5 text-[11px] text-ink-muted shadow-cute ring-1 ring-line backdrop-blur sm:block">
          <div><kbd className="rounded bg-card-soft px-1 font-mono ring-1 ring-line">T</kbd> {t("帕洛斯群島 · 世界樹")}</div>
          <div className="mt-0.5"><kbd className="rounded bg-card-soft px-1 font-mono ring-1 ring-line">F</kbd> {t("全螢幕")}</div>
          <div className="mt-0.5"><kbd className="rounded bg-card-soft px-1 font-mono ring-1 ring-line">Wheel</kbd> {t("放大 · 縮小")}</div>
        </div>

        {/* 疊在地圖右下角。Leaflet 自己的控制項 z-index 是 1000,要壓過它才點得到。 */}
        <button
          type="button"
          onClick={toggleFull}
          title={isFull ? t("離開全螢幕") : t("全螢幕檢視地圖")}
          aria-label={isFull ? t("離開全螢幕") : t("全螢幕檢視地圖")}
          className="absolute top-3 right-3 z-1002 flex size-9 items-center justify-center rounded-lg bg-card/90 text-ink shadow-cute ring-1 ring-line backdrop-blur transition hover:bg-card hover:text-pal hover:ring-pal"
        >
          {isFull ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
        </button>
      </div>
      </div>
    </div>
  );
}
