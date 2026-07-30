// 「玩家查詢」分頁：搜尋 + 玩家排序/篩選（在線優先）→ 玩家卡（含帕魯篩選/排序）。
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import type { Dataset } from "./data";
import { paldexId } from "./paldex";
import { getOnlinePlayers } from "./api";
import { PlayerCard } from "./PlayerCard";
import { PlayerMap } from "./PlayerMap";
import { t } from "../i18n";

type SortKey = "pals" | "level" | "exp" | "dex";
const SORTS: { key: SortKey; label: string; get: (p: Player, dex: number) => number }[] = [
  { key: "pals", label: "帕魯數", get: (p) => p.pal_count },
  { key: "level", label: "等級", get: (p) => p.level },
  { key: "exp", label: "經驗", get: (p) => p.exp },
  { key: "dex", label: "圖鑑數", get: (_p, dex) => dex },
];

export function PlayerQuery({
  data,
  onPalClick,
  initialQuery,
  initialPalQuery,
}: {
  data: Dataset;
  onPalClick: (p: Pal, owner?: Player) => void;
  initialQuery?: string; // 由帕魯詳情點持有玩家跳轉帶入
  initialPalQuery?: string; // 由持有玩家清單跳轉帶入：只顯示此帕魯
}): JSX.Element {
  const [q, setQ] = useState(initialQuery ?? "");
  const [palFilter, setPalFilter] = useState(initialPalQuery); // 可被 ✕ 清除的帕魯篩選
  const [sort, setSort] = useState<SortKey>("pals");
  const [onlineFirst, setOnlineFirst] = useState(true);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    getOnlinePlayers().then((names) => alive && setOnline(new Set(names)));
    return () => {
      alive = false;
    };
  }, []);

  const dexByPlayer = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const o of data.allPals) {
      const id = paldexId(o.pal.species);
      if (!id) continue;
      if (!m.has(o.owner.uid)) m.set(o.owner.uid, new Set());
      m.get(o.owner.uid)!.add(id);
    }
    return m;
  }, [data.allPals]);
  const dexCount = (p: Player) => dexByPlayer.get(p.uid)?.size ?? 0;
  const isOnline = (p: Player) => online.has(p.name.trim().toLowerCase());

  const matched = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sorter = SORTS.find((x) => x.key === sort)!;
    let list = data.players.filter(
      (p) => (!s || p.name.toLowerCase().includes(s) || p.uid.toLowerCase().includes(s)) && (!onlineOnly || isOnline(p)),
    );
    list = [...list].sort((a, b) => {
      if (onlineFirst) {
        const oa = isOnline(a) ? 1 : 0;
        const ob = isOnline(b) ? 1 : 0;
        if (oa !== ob) return ob - oa;
      }
      return sorter.get(b, dexCount(b)) - sorter.get(a, dexCount(a));
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, onlineFirst, onlineOnly, data.players, online, dexByPlayer]);

  const onlineCount = data.players.filter(isOnline).length;

  return (
    <div>
      {/* 小地圖:全玩家最後位置 + 公會據點;點頭像帶入搜尋跳到該玩家 */}
      <PlayerMap data={data} onPlayerClick={(p) => setQ(p.name)} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("🔍 搜尋玩家名稱或 UID…")}
          className="min-w-52 flex-1 rounded-xl bg-card px-4 py-2.5 text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
        />
        <span className="text-sm text-ink-muted">{t("排序")}</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink ring-1 ring-line sm:text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{t(s.label)}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-ink">
          <input type="checkbox" checked={onlineFirst} onChange={(e) => setOnlineFirst(e.target.checked)} />
          {t("在線優先")}
        </label>
        <label className="flex items-center gap-1 text-sm text-ink">
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          {t("只看在線")}
        </label>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span>{t("共 {n} 位玩家 · 目前在線", { n: matched.length })} <span className="font-semibold text-grass">{onlineCount}</span> {t("人")}</span>
        {palFilter && (
          <button
            onClick={() => setPalFilter(undefined)}
            title={t("清除帕魯篩選，顯示各玩家全部帕魯")}
            className="flex items-center gap-1.5 rounded-full bg-pal/15 px-2.5 py-1 text-xs text-pal ring-1 ring-pal/30 hover:bg-pal hover:text-white"
          >
            {t("已篩選帕魯：{name}", { name: palFilter })}
            <span className="text-sm leading-none">✕</span>
          </button>
        )}
      </div>
      <div className="space-y-6">
        {matched.map((p) => (
          <PlayerCard
            key={`${p.uid}-${palFilter ?? ""}`}
            player={p}
            online={isOnline(p)}
            onPalClick={onPalClick}
            defaultOpen={matched.length <= 3}
            initialPalQuery={palFilter}
          />
        ))}
      </div>
    </div>
  );
}
