// 玩家查詢的小地圖:全部玩家的最後存檔位置 + 公會據點(Leaflet CRS.Simple)。
// 底圖常數/樣式與管理端地圖共用(mapLayers + styles.css 的 pmap-*),座標經
// shared 的 savToMap/savToWorldTreeMap 換算;世界樹座標的實體只出現在世界樹底圖。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { savToMap, savToWorldTreeMap, isWorldTreeCoord, guildColorFromId } from "@palserver/shared";
import { MAP_IMAGE, IMAGE_BOUNDS, TREE_MAP_IMAGE, TREE_IMAGE_BOUNDS, escapeHtml } from "../mapLayers";
import { palInfo } from "./paldex";
import type { Player, Guild } from "./types";
import type { Dataset } from "./data";
import { t, useI18n } from "../i18n";

type World = "main" | "tree";

export function PlayerMap({
  data,
  onPlayerClick,
}: {
  data: Dataset;
  /** 點玩家頭像 → 跳到該玩家(帶入搜尋)。 */
  onPlayerClick?: (p: Player) => void;
}): JSX.Element | null {
  useI18n();
  const [world, setWorld] = useState<World>("main");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds>(IMAGE_BOUNDS);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const onPlayerClickRef = useRef(onPlayerClick);
  onPlayerClickRef.current = onPlayerClick;

  /** uid → 所屬公會(畫頭像框色與 tooltip 用)。 */
  const guildByUid = useMemo(() => {
    const m = new Map<string, Guild>();
    for (const g of data.guilds) for (const u of g.member_uids) m.set(u, g);
    return m;
  }, [data.guilds]);

  const located = useMemo(
    () => data.players.filter((p) => p.location && (p.location.x !== 0 || p.location.y !== 0)),
    [data.players],
  );
  const baseCount = useMemo(() => data.guilds.reduce((n, g) => n + g.bases.length, 0), [data.guilds]);
  /** 世界樹底圖只在有實體落在世界樹座標時才提供切換。 */
  const hasTree = useMemo(
    () =>
      located.some((p) => isWorldTreeCoord(p.location.x)) ||
      data.guilds.some((g) => g.bases.some((b) => isWorldTreeCoord(b.x))),
    [located, data.guilds],
  );

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

    for (const g of data.guilds) {
      const color = guildColorFromId(g.id);
      for (const b of g.bases) {
        const pos = project(b.x, b.y);
        if (!pos) continue;
        const icon = L.divIcon({
          className: "pmap-base-wrap",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          tooltipAnchor: [0, -16],
          html: `<span class="pmap-base" style="border-color:${color}"><img src="/game-data/landmark-icons/palbox.webp" alt="" /></span>`,
        });
        L.marker([pos.y, pos.x], { icon })
          .bindTooltip(
            `<div style="font-weight:800">${escapeHtml(g.name || t("無名公會"))}</div>` +
              `<div>${t("公會據點")} · Lv.${g.level} · ${t("{n} 名成員", { n: g.member_uids.length })}</div>`,
            { direction: "top", className: "pmap-detail" },
          )
          .addTo(group);
      }
    }

    const SIZE = 40;
    for (const p of located) {
      const pos = project(p.location.x, p.location.y);
      if (!pos) continue;
      // 頭像用該玩家最高等的帕魯(玩家本身沒有頭像圖);沒有帕魯就顯示名字首字。
      const iconUrl = p.pals[0] ? palInfo(p.pals[0].species).iconUrl : undefined;
      const guild = guildByUid.get(p.uid);
      const ring = guild ? guildColorFromId(guild.id) : "#ffffff";
      const icon = L.divIcon({
        className: "pmap-avatar-wrap",
        iconSize: [SIZE, SIZE],
        iconAnchor: [SIZE / 2, SIZE / 2],
        tooltipAnchor: [0, -SIZE / 2],
        html:
          `<span class="pmap-avatar" style="width:${SIZE}px;height:${SIZE}px;border-color:${ring}">` +
          (iconUrl
            ? `<img src="${escapeHtml(iconUrl)}" alt="" />`
            : `<b style="font-size:16px">${escapeHtml((p.name || "?").slice(0, 1))}</b>`) +
          `</span>`,
      });
      const marker = L.marker([pos.y, pos.x], { icon, riseOnHover: true });
      marker.bindTooltip(
        `<div style="font-weight:800">${escapeHtml(p.name || "—")}</div>` +
          (guild ? `<div style="color:${ring}">${escapeHtml(guild.name || t("無名公會"))}</div>` : "") +
          `<div>Lv.${p.level} · ${t("{n} 隻帕魯", { n: p.pal_count })}</div>`,
        { direction: "top", className: "pmap-detail" },
      );
      marker.on("click", () => onPlayerClickRef.current?.(p));
      marker.addTo(group);
    }
  }, [located, data.guilds, guildByUid, world]);

  if (!located.length && !baseCount) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-cute bg-card ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm font-bold text-ink">🗺️ {t("玩家地圖")}</span>
        <span className="text-xs text-ink-muted">
          {t("{n} 位玩家", { n: located.length })}
          {baseCount ? ` · ${t("{n} 個據點", { n: baseCount })}` : ""}
        </span>
        {hasTree && (
          <div className="ml-auto flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
            {(
              [
                ["main", t("主世界")],
                ["tree", t("世界樹")],
              ] as [World, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setWorld(k)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  world === k ? "bg-pal text-white" : "text-ink hover:bg-card"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={containerRef} className="h-[320px] w-full sm:h-[420px]" />
    </div>
  );
}
