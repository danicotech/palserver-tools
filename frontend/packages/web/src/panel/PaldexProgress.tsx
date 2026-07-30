// 「圖鑑收服率」分頁：全服 / 逐玩家的帕魯圖鑑收服進度（用法同首領進度）。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Dataset } from "./data";
import { getPalRoster, paldexId, localizedName } from "./paldex";
import { t } from "../i18n";

type Filter = "all" | "caught" | "missing";

export function PaldexProgress({ data, onOwnerPlayerClick }: { data: Dataset; onOwnerPlayerClick?: (playerName: string, palName: string) => void }): JSX.Element {
  const roster = useMemo(() => getPalRoster(), []);

  const { ownersByPal, caughtByPlayer } = useMemo(() => {
    const ownersByPal = new Map<string, Map<string, number>>();
    const caughtByPlayer = new Map<string, Set<string>>();
    for (const o of data.allPals) {
      const k = paldexId(o.pal.species);
      if (!k) continue;
      if (!ownersByPal.has(k)) ownersByPal.set(k, new Map());
      const mm = ownersByPal.get(k)!;
      mm.set(o.owner.name, (mm.get(o.owner.name) ?? 0) + 1);
      if (!caughtByPlayer.has(o.owner.uid)) caughtByPlayer.set(o.owner.uid, new Set());
      caughtByPlayer.get(o.owner.uid)!.add(k);
    }
    return { ownersByPal, caughtByPlayer };
  }, [data.allPals]);

  const playersByProgress = useMemo(
    () =>
      [...data.players]
        .map((p) => ({ player: p, caught: caughtByPlayer.get(p.uid)?.size ?? 0 }))
        .sort((a, b) => b.caught - a.caught),
    [data.players, caughtByPlayer],
  );

  const [view, setView] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"default" | "name" | "rate">("default");
  const [dlg, setDlg] = useState<{ name: string; iconUrl: string; owners: [string, number][] } | null>(null);
  const totalPlayers = data.players.length || 1;

  const selectedCaught = view === "all" ? null : caughtByPlayer.get(view) ?? new Set<string>();
  const isCaught = (k: string) =>
    view === "all" ? (ownersByPal.get(k)?.size ?? 0) > 0 : selectedCaught!.has(k);
  const ownerCount = (k: string) => ownersByPal.get(k)?.size ?? 0;

  const caughtCount = roster.filter((r) => isCaught(r.key)).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = roster.filter((r) => {
      const nm = localizedName(r.names);
      if (s && !nm.toLowerCase().includes(s) && !(r.names.en ?? "").toLowerCase().includes(s)) return false;
      if (filter === "caught") return isCaught(r.key);
      if (filter === "missing") return !isCaught(r.key);
      return true;
    });
    if (sort === "name") list = [...list].sort((a, b) => localizedName(a.names).localeCompare(localizedName(b.names)));
    else if (sort === "rate") list = [...list].sort((a, b) => ownerCount(b.key) - ownerCount(a.key));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, q, filter, sort, view, ownersByPal, caughtByPlayer]);
  const pct = roster.length ? ((caughtCount / roster.length) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
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
          placeholder={t("🔍 搜尋帕魯名稱…")}
          className="min-w-0 flex-1 rounded-lg bg-card-soft px-3 py-1.5 text-base text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:flex-none sm:text-sm"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "default" | "name" | "rate")}
          className="rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink ring-1 ring-line sm:text-sm"
        >
          <option value="default">{t("圖鑑順序")}</option>
          <option value="name">{t("名稱")}</option>
          <option value="rate">{t("已收服率（人數）")}</option>
        </select>
        <span className="ml-auto text-sm text-ink-muted">
          {view === "all" ? t("全服") : playersByProgress.find((x) => x.player.uid === view)?.player.name} {t("圖鑑收服")}{" "}
          <span className="font-bold text-pal">{caughtCount}</span> / {roster.length} {t("種（{pct}%）", { pct })}
        </span>
      </div>

      <div className="h-3 overflow-hidden rounded-full bg-card-soft">
        <div className="h-full bg-gradient-to-r from-pal to-grass" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {shown.map((r) => {
          const caught = isCaught(r.key);
          const owners = ownersByPal.get(r.key);
          return (
            <button
              key={r.key}
              onClick={() => setDlg({ name: localizedName(r.names), iconUrl: r.iconUrl, owners: [...(owners?.entries() ?? [])].sort((a, b) => b[1] - a[1]) })}
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
                <img src={r.iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{localizedName(r.names)}</span>
                {view === "all" && caught && owners && (
                  <span className="block text-[11px] text-ink-muted">
                    {t("{n} 人（{pct}%）", { n: owners.size, pct: ((owners.size / totalPlayers) * 100).toFixed(0) })}
                  </span>
                )}
              </span>
              {caught ? <span className="shrink-0 text-pal">✓</span> : <span className="shrink-0 text-xs text-ink-muted">—</span>}
            </button>
          );
        })}
      </div>

      <OwnerDialog dlg={dlg} totalPlayers={totalPlayers} onClose={() => setDlg(null)} onPlayerClick={onOwnerPlayerClick} />
    </div>
  );
}

/** 擁有者玩家列表彈窗（圖鑑/首領共用樣式）。 */
export function OwnerDialog({
  dlg,
  totalPlayers,
  onClose,
  onPlayerClick,
}: {
  dlg: { name: string; iconUrl: string; owners: [string, number][] } | null;
  totalPlayers: number;
  onClose: () => void;
  onPlayerClick?: (playerName: string, palName: string) => void; // 點玩家 → 玩家查詢並篩此帕魯
}): JSX.Element | null {
  if (!dlg) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-cute bg-card p-4 ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-sky-soft ring-1 ring-line">
              <img src={dlg.iconUrl} alt="" className="h-full w-full object-cover" />
            </span>
            <div>
              <div className="font-bold text-ink">{dlg.name}</div>
              <div className="text-xs text-ink-muted">
                {t("{n} 人擁有（{pct}%）", { n: dlg.owners.length, pct: ((dlg.owners.length / totalPlayers) * 100).toFixed(0) })}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-card-soft hover:text-ink">✕</button>
        </div>
        {dlg.owners.length === 0 ? (
          <div className="py-6 text-center text-ink-muted">{t("尚無人收服")}</div>
        ) : (
          <div className="space-y-1">
            {dlg.owners.map(([name, count], i) =>
              onPlayerClick ? (
                <button
                  key={name}
                  onClick={() => onPlayerClick(name, dlg.name)}
                  title={t("前往玩家查詢，只看 {name} 的 {pal}", { name, pal: dlg.name })}
                  className="flex w-full items-center gap-2 rounded-lg bg-card-soft px-3 py-1.5 text-left text-sm hover:bg-pal/15 hover:ring-1 hover:ring-pal/40"
                >
                  <span className="w-5 text-right text-xs text-ink-muted">{i + 1}</span>
                  <span className="flex-1 truncate text-ink">{name}</span>
                  <span className="tabular-nums text-pal">×{count}</span>
                  <span className="text-xs text-ink-muted">›</span>
                </button>
              ) : (
                <div key={name} className="flex items-center gap-2 rounded-lg bg-card-soft px-3 py-1.5 text-sm">
                  <span className="w-5 text-right text-xs text-ink-muted">{i + 1}</span>
                  <span className="flex-1 truncate text-ink">{name}</span>
                  <span className="tabular-nums text-pal">×{count}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
