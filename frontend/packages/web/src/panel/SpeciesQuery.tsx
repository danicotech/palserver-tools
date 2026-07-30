// 「帕魯查詢」分頁：搜尋 → 可摺疊的全物種報表 → 選定物種的詳情（各玩家數量 + 可摺疊的全部個體卡片）。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import type { Dataset, SpeciesGroup } from "./data";
import { ElementBadge, Chip } from "./ui";
import { PalTile } from "./PalTile";
import { PalBrowser } from "./PalBrowser";
import { palName } from "./paldex";
import { t } from "../i18n";

type Sort = "total" | "owners" | "name" | "paldeck";
const SORT_LABELS: Record<Sort, string> = {
  total: "全服總數",
  owners: "擁有人數",
  name: "名稱",
  paldeck: "圖鑑編號",
};

export function SpeciesQuery({
  data,
  onPalClick,
  initialFilter,
}: {
  data: Dataset;
  onPalClick: (p: Pal, owner?: Player) => void;
  initialFilter?: { trait?: string; work?: string; query?: string };
}): JSX.Element {
  const [mode, setMode] = useState<"report" | "search">("search");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("total");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [tableOpen, setTableOpen] = useState(true);
  const [selected, setSelected] = useState<SpeciesGroup | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data.species.filter(
      (g) => !s || g.name_zh.toLowerCase().includes(s) || g.name_en.toLowerCase().includes(s) || g.paldeck.includes(s),
    );
    const cmp = (a: SpeciesGroup, b: SpeciesGroup) => {
      let base: number;
      if (sort === "name") base = a.name_zh.localeCompare(b.name_zh);
      else if (sort === "owners") base = a.owners - b.owners || a.total - b.total;
      else if (sort === "paldeck") base = (Number(a.paldeck) || 9999) - (Number(b.paldeck) || 9999);
      else base = a.total - b.total;
      return dir === "desc" ? -base : base;
    };
    return [...list].sort(cmp);
  }, [data.species, q, sort, dir]);

  return (
    <div className="space-y-3">
      {/* 模式切換 */}
      <div className="flex rounded-lg bg-card p-1 ring-1 ring-line">
        {([["search", "🔎 全服帕魯搜尋"], ["report", "📊 物種報表"]] as ["report" | "search", string][]).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === k ? "bg-pal text-white" : "text-ink hover:bg-card-soft"}`}
            >
              {t(label)}
            </button>
          ),
        )}
      </div>

      {mode === "search" && (
        <PalBrowser
          pals={data.allPals}
          showOwner
          onPalClick={onPalClick}
          initialTrait={initialFilter?.trait}
          initialWork={initialFilter?.work}
          initialQuery={initialFilter?.query}
        />
      )}

      {mode === "report" && (
        <>
          {/* 搜尋（置頂） */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("🔍 搜尋帕魯名稱 / 圖鑑編號…")}
            className="w-full rounded-xl bg-card px-4 py-3 text-ink shadow-cute outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
          />

      {/* 全物種報表（可摺疊） */}
      <div className="overflow-hidden rounded-cute ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2 bg-card px-3 py-2">
          <button onClick={() => setTableOpen((o) => !o)} className="font-semibold text-ink">
            {tableOpen ? "▾" : "▸"} {t("全物種列表（{n} 種）", { n: rows.length })}
          </button>
          <div className="ml-auto flex items-center gap-1 text-sm">
            <span className="text-ink-muted">{t("排序")}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-lg bg-card-soft px-2 py-1 text-base text-ink ring-1 ring-line sm:text-sm"
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <option key={s} value={s}>{t(SORT_LABELS[s])}</option>
              ))}
            </select>
            <button
              onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="rounded-lg bg-card-soft px-2 py-1 text-ink ring-1 ring-line hover:ring-pal"
              title={dir === "desc" ? t("降序") : t("升序")}
            >
              {dir === "desc" ? t("▼ 降序") : t("▲ 升序")}
            </button>
          </div>
        </div>
        {tableOpen && (
          <div className="max-h-[60dvh] overflow-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="sticky top-0 bg-card-soft text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">{t("帕魯")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("屬性")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("全服總數")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("擁有人數")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("誰最多")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr
                    key={g.key}
                    onClick={() => setSelected(g)}
                    className={`cursor-pointer border-t border-line hover:bg-card-soft/60 ${
                      selected?.key === g.key ? "bg-pal/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums text-ink-muted">{g.paldeck || i + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink">{palName(g.species) || g.name_zh}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {g.elements.map((e) => (
                          <ElementBadge key={e} el={e} />
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-pal">{g.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{g.owners}</td>
                    <td className="px-3 py-2 text-ink">
                      {g.perPlayer[0] && (
                        <>
                          👑 {g.perPlayer[0].player.name}
                          <span className="text-ink-muted"> ×{g.perPlayer[0].count}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

          {/* 選定物種的詳情（在報表下方） */}
          {selected && <SpeciesDetail group={selected} onClose={() => setSelected(null)} onPalClick={onPalClick} />}
        </>
      )}
    </div>
  );
}

function SpeciesDetail({
  group,
  onClose,
  onPalClick,
}: {
  group: SpeciesGroup;
  onClose: () => void;
  onPalClick: (p: Pal, owner?: Player) => void;
}): JSX.Element {
  const max = group.perPlayer[0]?.count ?? 1;
  const [cardsOpen, setCardsOpen] = useState(true);
  return (
    <div className="rounded-cute bg-card p-4 shadow-cute ring-1 ring-pal/30">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-ink">{palName(group.species) || group.name_zh}</h2>
            {group.elements.map((e) => (
              <ElementBadge key={e} el={e} />
            ))}
          </div>
          <div className="text-sm text-ink-muted">
            {group.name_en} {group.paldeck && `· No.${group.paldeck}`}
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-card-soft hover:text-ink">
          ✕
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip tone="sky">{t("全服總數 {n} 隻", { n: group.total })}</Chip>
        <Chip>{t("擁有玩家 {n} 人", { n: group.owners })}</Chip>
        <Chip tone="amber">👑 {t("抓最多：{name} ×{count}", { name: group.perPlayer[0]?.player.name ?? "", count: group.perPlayer[0]?.count ?? 0 })}</Chip>
      </div>

      {/* 各玩家分別抓幾隻 */}
      <div className="mb-4">
        <div className="mb-2 text-sm font-semibold text-ink">{t("各玩家抓了幾隻")}</div>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {group.perPlayer.map(({ player, count }, i) => (
            <div key={player.uid} className="flex items-center gap-2 text-sm">
              <span className="w-5 shrink-0 text-right text-xs text-ink-muted">{i + 1}</span>
              <span className="w-28 shrink-0 truncate text-ink">{player.name}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-card-soft">
                <div
                  className={`h-full ${i === 0 ? "bg-sun" : "bg-pal"}`}
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-ink">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 全部個體（可摺疊） */}
      <div>
        <button onClick={() => setCardsOpen((o) => !o)} className="mb-2 text-sm font-semibold text-ink">
          {cardsOpen ? "▾" : "▸"} {t("全部個體（{n} 隻）· 依戰力排序，點卡片看詳情", { n: group.total })}
        </button>
        {cardsOpen && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.specimens.map(({ pal, owner }, i) => (
              <PalTile key={i} pal={pal} owner={owner.name} onClick={() => onPalClick(pal, owner)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
