// 「詞條查詢」：詞條卡片雲（多選、可複合 AND/OR）置頂；下方為各玩家擁有數，
// 點某玩家開 dialog 列出其符合條件的帕魯（含 PalBrowser 篩選/排序）。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import type { Dataset, OwnedPal } from "./data";
import { Chip } from "./ui";
import { PalBrowser } from "./PalBrowser";
import { PASSIVE_CATS, SKILL_CATS, passiveCat, skillCat } from "./traitCategories";
import { localizeTrait } from "./paldex";
import { t } from "../i18n";

type Kind = "passive" | "skill";

function traitsOf(pal: Pal, kind: Kind): string[] {
  return kind === "passive"
    ? pal.passives
    : [...new Set([...pal.active_skills, ...pal.mastered_skills])];
}

export function TraitQuery({
  data,
  onPalClick,
}: {
  data: Dataset;
  onPalClick: (p: Pal, owner?: Player) => void;
}): JSX.Element {
  const [kind, setKind] = useState<Kind>("passive");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"and" | "or">("and");
  const [dialog, setDialog] = useState<{ playerName: string; pals: OwnedPal[] } | null>(null);

  const traits = useMemo(() => {
    // 「並且」複合時，計數池縮小為「已擁有全部已選詞條」的帕魯，
    // 其餘詞條顯示的即為與已選詞條的「共同出現數」；共同數為 0 者不會出現（等於被 filter 掉）。
    const useContext = mode === "and" && selected.length > 0;
    const pool = useContext
      ? data.allPals.filter((o) => {
          const ts = traitsOf(o.pal, kind);
          return selected.every((s) => ts.includes(s));
        })
      : data.allPals;
    const m = new Map<string, number>();
    for (const o of pool) for (const t of traitsOf(o.pal, kind)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }, [data.allPals, kind, selected, mode]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? traits.filter((t) => t.name.toLowerCase().includes(s)) : traits;
  }, [traits, q]);

  const toggle = (name: string) =>
    setSelected((sel) => (sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name]));

  // 依分類把詞條分組成 Tier 分層表
  const cats = kind === "passive" ? PASSIVE_CATS : SKILL_CATS;
  const catOf = kind === "passive" ? passiveCat : skillCat;
  const rows = useMemo(() => {
    const byCat = new Map<string, { name: string; total: number }[]>();
    for (const t of filtered) {
      const c = catOf(t.name);
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(t);
    }
    return cats.map((c) => ({ cat: c, items: byCat.get(c.key) ?? [] })).filter((r) => r.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, kind]);

  const matched = useMemo<OwnedPal[]>(() => {
    if (!selected.length) return [];
    return data.allPals.filter((o) => {
      const ts = traitsOf(o.pal, kind);
      return mode === "and" ? selected.every((s) => ts.includes(s)) : selected.some((s) => ts.includes(s));
    });
  }, [data.allPals, kind, selected, mode]);

  const perPlayer = useMemo(() => {
    const m = new Map<string, { name: string; pals: OwnedPal[] }>();
    for (const o of matched) {
      if (!m.has(o.owner.uid)) m.set(o.owner.uid, { name: o.owner.name, pals: [] });
      m.get(o.owner.uid)!.pals.push(o);
    }
    return [...m.values()].sort((a, b) => b.pals.length - a.pals.length);
  }, [matched]);
  const max = perPlayer[0]?.pals.length ?? 1;

  return (
    <div className="space-y-4">
      {/* 控制列 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-card p-1 ring-1 ring-line">
          {(["passive", "skill"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setSelected([]);
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? "bg-pal text-white" : "text-ink hover:bg-card-soft"}`}
            >
              {k === "passive" ? t("被動技能（詞條）") : t("主動技能")}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("搜尋詞條名稱…（可點多個詞條做複合查詢）")}
          className="min-w-52 flex-1 rounded-xl bg-card px-4 py-2.5 text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
        />
        {selected.length > 1 && (
          <div className="flex rounded-lg bg-card-soft p-0.5 text-sm ring-1 ring-line">
            <button onClick={() => setMode("and")} className={`rounded px-2 py-1 ${mode === "and" ? "bg-pal text-white" : "text-ink-muted"}`}>{t("並且")}</button>
            <button onClick={() => setMode("or")} className={`rounded px-2 py-1 ${mode === "or" ? "bg-pal text-white" : "text-ink-muted"}`}>{t("或者")}</button>
          </div>
        )}
        {selected.length > 0 && (
          <button onClick={() => setSelected([])} className="rounded-lg bg-berry/20 px-2 py-1.5 text-xs text-berry ring-1 ring-berry/40 hover:bg-berry/30">
            ✕ {t("清除選取（{n}）", { n: selected.length })}
          </button>
        )}
      </div>

      {/* 詞條分層表（Tier）：左彩色分類標籤 + 右該類詞條 */}
      <div className="space-y-1.5">
        {rows.map(({ cat, items }) => (
          <div key={cat.key} className="flex overflow-hidden rounded-lg ring-1 ring-line">
            <div
              className="flex w-24 shrink-0 items-center justify-center px-2 py-2 text-center text-sm font-bold leading-tight text-white"
              style={{ backgroundColor: cat.color }}
            >
              {t(cat.label)}
            </div>
            <div className="flex flex-1 flex-wrap content-start gap-1.5 bg-card-soft/40 p-2">
              {items.map((t) => {
                const on = selected.includes(t.name);
                return (
                  <button
                    key={t.name}
                    onClick={() => toggle(t.name)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ring-1 transition ${
                      on ? "bg-pal text-white ring-pal" : "bg-card text-ink ring-line hover:ring-pal/50"
                    }`}
                  >
                    <span>{localizeTrait(t.name)}</span>
                    <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-black/25 text-white" : "bg-black/10 text-ink-muted"}`}>{t.total}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="py-6 text-center text-sm text-ink-muted">{t("找不到符合的詞條")}</div>}
      </div>

      {/* 數據（置底） */}
      {selected.length > 0 && (
        <div className="rounded-cute bg-card p-4 shadow-cute ring-1 ring-pal/30">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip tone="sky">{t("符合 {n} 隻", { n: matched.length })}</Chip>
            <Chip>{t("{n} 位玩家", { n: perPlayer.length })}</Chip>
            <span className="text-sm text-ink-muted">
              {t("條件：{cond}", { cond: selected.map(localizeTrait).join(mode === "and" ? ` ${t("且")} ` : ` ${t("或")} `) })}
            </span>
          </div>
          <div className="mb-2 text-sm font-semibold text-ink">{t("各玩家擁有數（點一列看該玩家符合的帕魯）")}</div>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {perPlayer.map(({ name, pals }, i) => (
              <button
                key={name}
                onClick={() => setDialog({ playerName: name, pals })}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-card-soft"
              >
                <span className="w-5 shrink-0 text-right text-xs text-ink-muted">{i + 1}</span>
                <span className="w-28 shrink-0 truncate text-left text-ink">{name}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-card-soft">
                  <div className={`h-full ${i === 0 ? "bg-sun" : "bg-pal"}`} style={{ width: `${(pals.length / max) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums text-ink">{pals.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 玩家帕魯 dialog（含篩選/排序） */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDialog(null)}>
          <div
            className="max-h-[88dvh] w-full max-w-6xl overflow-y-auto rounded-cute bg-card p-4 ring-1 ring-line"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">
                {dialog.playerName} · {t("符合條件的帕魯（{n}）", { n: dialog.pals.length })}
              </h2>
              <button onClick={() => setDialog(null)} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-card-soft hover:text-ink">
                ✕
              </button>
            </div>
            <PalBrowser pals={dialog.pals} showOwner={false} onPalClick={onPalClick} />
          </div>
        </div>
      )}
    </div>
  );
}
