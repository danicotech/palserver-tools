// 玩家查詢的地圖:全部玩家的最後存檔位置 + 公會據點(Leaflet CRS.Simple)。
// 底圖常數/樣式與管理端地圖共用(mapLayers + styles.css 的 pmap-*),座標經
// shared 的 savToMap/savToWorldTreeMap 換算;世界樹座標的實體只出現在世界樹底圖。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FiMaximize, FiMinimize } from "react-icons/fi";
import { savToMap, savToWorldTreeMap, isWorldTreeCoord, guildColorFromId } from "@palserver/shared";
import {
  MAP_IMAGE,
  IMAGE_BOUNDS,
  TREE_MAP_IMAGE,
  TREE_IMAGE_BOUNDS,
  MAP_TILES,
  MAP_TILES_MAXNATIVE,
  TILE_CRS,
  hasMapTiles,
  escapeHtml,
} from "../mapLayers";
import { usePlayerAvatar, playerInitial } from "./playerAvatar";
import type { Player, Guild } from "./types";
import type { Dataset } from "./data";
import { t, useI18n } from "../i18n";

type World = "main" | "tree";
type WhoFilter = "all" | "online" | "offline";

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
  const [tiles, setTiles] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void hasMapTiles().then((ok) => alive && setTiles(ok));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current || tiles === null) return;
    const map = L.map(el, {
      crs: tiles ? TILE_CRS : L.CRS.Simple,
      attributionControl: false,
      // 圖磚模式用連續縮放:fitBounds 才會剛好貼合容器,不會被量化後留一圈空白。
      // 對畫質沒有損失 —— 非整數層級時 Leaflet 取較深的圖磚往下縮,縮小是銳利的。
      zoomSnap: 0,
      // 圖磚模式下 zoom 就是圖磚層級,允許超出原生兩級(拉伸 z6,仍比單張底圖清楚)
      maxZoom: tiles ? MAP_TILES_MAXNATIVE + 2 : 4,
    });
    map.setView(IMAGE_BOUNDS.getCenter(), tiles ? 2 : -2);
    el.style.background = "transparent";
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // 容器高度由版面決定,首輪可能是 0:用 ResizeObserver 校正 fit 與最小縮放。
    let fitted = false;
    const applySize = () => {
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
        ? L.tileLayer(MAP_TILES, {
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
    /** tooltip 用的座標字串(與遊戲內地圖顯示同一套) */
    const coord = (pos: { x: number; y: number }) => `${Math.round(pos.x)}, ${Math.round(pos.y)}`;

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
            html: `<span class="pmap-base" style="border-color:${color}"><img src="/game-data/landmark-icons/palbox.webp" alt="" /></span>`,
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
        <span className="text-sm font-bold text-ink">🗺️ {t("玩家地圖")}</span>
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
      {/* 高度變化一律做在「外層」,地圖容器的 className 必須從頭到尾固定不變。
          原因:L.map() 會直接在這個 DOM 元素上加 leaflet-container / leaflet-touch 等 class,
          而 React 只要重繪就會用自己的 className 整個覆蓋掉,把那些 class 洗掉。
          少了 .leaflet-container,Leaflet 的 CSS(含 img.leaflet-image-layer 的 max-width:none)
          全部失效,底圖寬度被 preflight 的 img{max-width:100%} 壓成 0 —— 症狀就是「進全螢幕後地圖不見了」。 */}
      <div className={`relative ${isFull ? "min-h-0 flex-1" : "h-80 sm:h-115"}`}>
        <div ref={containerRef} className="size-full" />
        {/* 疊在地圖右下角。Leaflet 自己的控制項 z-index 是 1000,要壓過它才點得到。 */}
        <button
          type="button"
          onClick={toggleFull}
          title={isFull ? t("離開全螢幕") : t("全螢幕檢視地圖")}
          aria-label={isFull ? t("離開全螢幕") : t("全螢幕檢視地圖")}
          className="absolute bottom-3 right-3 z-1001 flex size-9 items-center justify-center rounded-lg bg-card/90 text-ink shadow-cute ring-1 ring-line backdrop-blur transition hover:bg-card hover:text-pal hover:ring-pal"
        >
          {isFull ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
        </button>
      </div>
    </div>
  );
}
