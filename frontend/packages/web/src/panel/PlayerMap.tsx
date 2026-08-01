// 玩家查詢的地圖:全部玩家的最後存檔位置 + 公會據點(Leaflet CRS.Simple)。
// 底圖常數/樣式與管理端地圖共用(mapLayers + styles.css 的 pmap-*),座標經
// shared 的 savToMap/savToWorldTreeMap 換算;世界樹座標的實體只出現在世界樹底圖。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { savToMap, savToWorldTreeMap, isWorldTreeCoord, guildColorFromId } from "@palserver/shared";
import { MAP_IMAGE, IMAGE_BOUNDS, TREE_MAP_IMAGE, TREE_IMAGE_BOUNDS, escapeHtml } from "../mapLayers";
import { playerAvatarUrl, playerInitial } from "./playerAvatar";
import type { Player, Guild } from "./types";
import type { Dataset } from "./data";
import { t, useI18n } from "../i18n";

type World = "main" | "tree";
type WhoFilter = "all" | "online" | "offline";

export function PlayerMap({
  data,
  online,
  onPlayerClick,
}: {
  data: Dataset;
  /** 目前在線的玩家名稱(小寫);用於在線/離線篩選 */
  online: Set<string>;
  /** 點玩家頭像 → 跳到該玩家(帶入搜尋)。 */
  onPlayerClick?: (p: Player) => void;
}): JSX.Element | null {
  useI18n();
  const [world, setWorld] = useState<World>("main");
  const [who, setWho] = useState<WhoFilter>("all");
  const [guildFilter, setGuildFilter] = useState("all");
  const [showBases, setShowBases] = useState(true);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds>(IMAGE_BOUNDS);
  const markersRef = useRef<L.LayerGroup | null>(null);
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { crs: L.CRS.Simple, attributionControl: false, zoomSnap: 0.25, maxZoom: 4 });
    map.setView(IMAGE_BOUNDS.getCenter(), -2);
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
  }, []);

  // 底圖切換(主世界/世界樹)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = world === "tree" ? TREE_IMAGE_BOUNDS : IMAGE_BOUNDS;
    boundsRef.current = bounds;
    const overlay = L.imageOverlay(world === "tree" ? TREE_MAP_IMAGE : MAP_IMAGE, bounds).addTo(map);
    overlay.bringToBack();
    map.setMaxBounds(bounds.pad(0.3));
    if (map.getSize().y > 0) {
      map.setMinZoom(map.getBoundsZoom(bounds) - 1);
      map.fitBounds(bounds);
    }
    return () => {
      map.removeLayer(overlay);
    };
  }, [world]);

  // 標記:據點在下、玩家在上
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
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
          L.marker([pos.y, pos.x], { icon })
            .bindTooltip(
              `<div style="font-weight:800">${escapeHtml(g.name || t("無名公會"))} · ${t("據點")} ${i + 1}/${g.bases.length}</div>` +
                `<div>Lv.${g.level} · ${t("{n} 名成員", { n: g.member_uids.length })}</div>` +
                `<div>${t("座標")} ${coord(pos)}</div>`,
              { direction: "top", className: "pmap-detail" },
            )
            .addTo(group);
        });
      }
    }

    const SIZE = 40;
    for (const p of shownPlayers) {
      const pos = project(p.location.x, p.location.y);
      if (!pos) continue;
      // 頭像與玩家列表用同一份規則,兩邊才會長一樣
      const iconUrl = playerAvatarUrl(p);
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
      const marker = L.marker([pos.y, pos.x], { icon, riseOnHover: true });
      marker.bindTooltip(
        `<div style="font-weight:800">${escapeHtml(p.name || "—")}${on ? ` · ${t("在線")}` : ""}</div>` +
          (guild ? `<div style="color:${ring}">${escapeHtml(guild.name || t("無名公會"))}</div>` : "") +
          `<div>Lv.${p.level} · ${t("{n} 隻帕魯", { n: p.pal_count })}</div>` +
          `<div>${t("座標")} ${coord(pos)}</div>`,
        { direction: "top", className: "pmap-detail" },
      );
      marker.on("click", () => onPlayerClickRef.current?.(p));
      marker.addTo(group);
    }
  }, [shownPlayers, shownGuilds, showBases, guildByUid, world, online]);

  if (!located.length && !data.guilds.length) return null;

  const btn = (active: boolean) =>
    `min-h-8 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition ${
      active ? "bg-pal text-white" : "text-ink hover:bg-card"
    }`;

  return (
    <div className="mt-4 overflow-hidden rounded-cute bg-card ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm font-bold text-ink">🗺️ {t("玩家地圖")}</span>
        <span className="text-xs text-ink-muted">
          {t("{n} 位玩家", { n: shownPlayers.length })}
          {showBases ? ` · ${t("{n} 個據點", { n: baseCount })}` : ""}
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
      <div ref={containerRef} className="h-[320px] w-full sm:h-[460px]" />
    </div>
  );
}
