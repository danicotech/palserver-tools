// 「首領進度」分頁：全服 / 逐玩家的首領收服進度。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Dataset } from "./data";
import { bossKey, getBossRoster, localizedName } from "./paldex";
import { OwnerDialog } from "./PaldexProgress";
import { t } from "../i18n";

type Filter = "all" | "caught" | "missing";

export function BossProgress({ data, onOwnerPlayerClick }: { data: Dataset; onOwnerPlayerClick?: (playerName: string, palName: string) => void }): JSX.Element {
  const roster = useMemo(() => getBossRoster(), []);
  const [dlg, setDlg] = useState<{ name: string; iconUrl: string; owners: [string, number][] } | null>(null);

  // 每隻首領被哪些玩家收服（含各玩家數量）；每位玩家收服了哪些首領。
  const { ownersByBoss, caughtByPlayer } = useMemo(() => {
    const ownersByBoss = new Map<string, Map<string, number>>();
    const caughtByPlayer = new Map<string, Set<string>>();
    for (const o of data.allPals) {
      if (!o.pal.is_alpha) continue;
      const k = bossKey(o.pal.species);
      if (!ownersByBoss.has(k)) ownersByBoss.set(k, new Map());
      const mm = ownersByBoss.get(k)!;
      mm.set(o.owner.name, (mm.get(o.owner.name) ?? 0) + 1);
      if (!caughtByPlayer.has(o.owner.uid)) caughtByPlayer.set(o.owner.uid, new Set());
      caughtByPlayer.get(o.owner.uid)!.add(k);
    }
    return { ownersByBoss, caughtByPlayer };
  }, [data.allPals]);

  // 玩家依「收服首領種數」排序（供下拉選單）
  const playersByProgress = useMemo(() => {
    return [...data.players]
      .map((p) => {
        const caught = new Set([...(caughtByPlayer.get(p.uid) ?? [])].filter((k) => roster.some((b) => b.key === k)));
        return { player: p, caught: caught.size };
      })
      .sort((a, b) => b.caught - a.caught);
  }, [data.players, caughtByPlayer, roster]);

  const [view, setView] = useState<string>("all"); // "all" | player uid
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"default" | "name" | "rate" | "lv">("default");
  const totalPlayers = data.players.length || 1;

  const selectedCaught = view === "all" ? null : caughtByPlayer.get(view) ?? new Set<string>();
  const isCaught = (k: string) =>
    view === "all" ? (ownersByBoss.get(k)?.size ?? 0) > 0 : selectedCaught!.has(k);
  const ownerCount = (k: string) => ownersByBoss.get(k)?.size ?? 0;

  const caughtCount = roster.filter((b) => isCaught(b.key)).length;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = roster.filter((b) => {
      const nm = localizedName(b.names);
      if (s && !nm.toLowerCase().includes(s) && !(b.names.en ?? "").toLowerCase().includes(s)) return false;
      if (filter === "caught") return isCaught(b.key);
      if (filter === "missing") return !isCaught(b.key);
      return true;
    });
    if (sort === "name") list = [...list].sort((a, b) => localizedName(a.names).localeCompare(localizedName(b.names)));
    else if (sort === "lv") list = [...list].sort((a, b) => b.lv - a.lv);
    else if (sort === "rate") list = [...list].sort((a, b) => ownerCount(b.key) - ownerCount(a.key));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, q, filter, sort, view, ownersByBoss, caughtByPlayer]);

  return (
    <div className="space-y-4">
      {/* 控制列 */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={view}
          onChange={(e) => setView(e.target.value)}
          className="w-full min-w-0 max-w-full truncate rounded-lg bg-card-soft px-3 py-2 text-ink ring-1 ring-line sm:w-auto"
        >
          <option value="all">🌐 {t("全服總覽")}</option>
          {playersByProgress.map(({ player, caught }) => (
            <option key={player.uid} value={player.uid}>
              {player.name}（{caught}/{roster.length}）
            </option>
          ))}
        </select>
        <div className="flex rounded-lg bg-card-soft p-0.5 text-sm ring-1 ring-line">
          {([["all", "全部"], ["caught", "已收服"], ["missing", "未收服"]] as [Filter, string][]).map(
            ([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded px-3 py-1 ${filter === k ? "bg-pal text-white" : "text-ink-muted"}`}
              >
                {t(label)}
              </button>
            ),
          )}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("🔍 搜尋首領名稱…")}
          className="min-w-0 flex-1 rounded-lg bg-card-soft px-3 py-1.5 text-base text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:flex-none sm:text-sm"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "default" | "name" | "rate" | "lv")}
          className="rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink ring-1 ring-line sm:text-sm"
        >
          <option value="default">{t("預設")}</option>
          <option value="name">{t("名稱")}</option>
          <option value="lv">{t("等級")}</option>
          <option value="rate">{t("已收服率（人數）")}</option>
        </select>
        <span className="ml-auto text-sm text-ink-muted">
          {view === "all" ? t("全服") : playersByProgress.find((x) => x.player.uid === view)?.player.name} {t("已收服")}{" "}
          <span className="font-bold text-pal">{caughtCount}</span> / {roster.length} {t("種首領")}
        </span>
      </div>

      {/* 進度條 */}
      <div className="h-3 overflow-hidden rounded-full bg-card-soft">
        <div
          className="h-full bg-gradient-to-r from-pal to-grass"
          style={{ width: `${roster.length ? (caughtCount / roster.length) * 100 : 0}%` }}
        />
      </div>

      {/* 首領網格 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((b) => {
          const caught = isCaught(b.key);
          const owners = ownersByBoss.get(b.key);
          return (
            <button
              key={b.key + b.lv}
              onClick={() => setDlg({ name: localizedName(b.names), iconUrl: b.iconUrl, owners: [...(owners?.entries() ?? [])].sort((x, y) => y[1] - x[1]) })}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left ring-1 transition hover:ring-pal ${
                caught ? "bg-card ring-pal/40" : "bg-card-soft ring-line"
              }`}
              title={t("點擊看擁有的玩家")}
            >
              <span
                className={`h-9 w-9 shrink-0 overflow-hidden rounded-full bg-sky-soft ring-1 ring-line ${
                  caught ? "" : "opacity-60 grayscale"
                }`}
              >
                <img src={b.iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{localizedName(b.names)}</span>
                <span className="block text-[11px] text-ink-muted">
                  Lv {b.lv}
                  {view === "all" && caught && owners
                    ? ` · ${t("{n} 人（{pct}%）", { n: owners.size, pct: ((owners.size / totalPlayers) * 100).toFixed(0) })}`
                    : ""}
                </span>
              </span>
              {caught ? (
                <span className="shrink-0 text-pal">✓</span>
              ) : (
                <span className="shrink-0 text-xs text-ink-muted">—</span>
              )}
            </button>
          );
        })}
      </div>

      <OwnerDialog dlg={dlg} totalPlayers={totalPlayers} onClose={() => setDlg(null)} onPlayerClick={onOwnerPlayerClick} />
    </div>
  );
}
