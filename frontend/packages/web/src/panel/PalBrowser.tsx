// 共用帕魯瀏覽器：搜尋 + 排序常駐一列，其餘條件收在可展開的「篩選」面板
// （基本/星級/屬性/工作適應性/詞條），下方以「已篩選」膠囊回報目前生效的條件。
// 供「玩家查詢」與「帕魯查詢的全服搜尋」共用。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import type { Pal, Player } from "./types";
import type { OwnedPal } from "./data";
import { palScore, ivSum } from "./data";
import { palInfo, localizeTrait, localizeWork } from "./paldex";
import { ElementBadge, WorkIcon } from "./ui";
import { PalTile } from "./PalTile";
import { t } from "../i18n";

type SortKey = "score" | "level" | "iv" | "hp" | "attack" | "defense" | "work" | "friendship" | "name";
const maxWork = (p: Pal) => {
  const v = Object.values(p.work);
  return v.length ? Math.max(...v) : 0;
};
const SORTS: { key: SortKey; label: string; fn: (p: Pal) => number | string }[] = [
  { key: "score", label: "綜合戰力", fn: palScore },
  { key: "level", label: "等級", fn: (p) => p.level },
  { key: "iv", label: "個體值總和", fn: ivSum },
  { key: "hp", label: "血量 IV", fn: (p) => p.iv_hp },
  { key: "attack", label: "攻擊 IV", fn: (p) => p.iv_attack },
  { key: "defense", label: "防禦 IV", fn: (p) => p.iv_defense },
  { key: "work", label: "工作效率", fn: maxWork },
  { key: "friendship", label: "好感度", fn: (p) => p.friendship },
  { key: "name", label: "名稱", fn: (p) => p.name_zh },
];

const BATCH = 60; // 每次載入的卡片數（往下捲動再載更多，避免一次渲染上萬張）

/** 篩選面板裡的一組:左邊固定寬度的標題 + 右邊自動換行的選項。
 *  標題對齊是關鍵 —— 原本每一列的開頭寬度都不一樣,看起來就是一堆散裝控制項。 */
function FilterRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-2 text-xs font-bold text-ink-muted">{label}</span>
      {/* 選項另外包一層才會「在右欄內部」換行;直接讓標題與選項同層 flex-wrap 的話,
          換到第二行的選項會退回容器最左邊,跟標題對齊 —— 工作適應性有 11 個一定會換行。 */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** 多選條件的「或者 / 並且」切換（工作適應性與詞條共用同一種外觀）。 */
function ModeToggle({ mode, onChange }: { mode: "or" | "and"; onChange: (m: "or" | "and") => void }): JSX.Element {
  return (
    <div className="ml-1 flex rounded-lg bg-card p-0.5 text-xs ring-1 ring-line">
      {(["or", "and"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded px-2 py-1 ${mode === m ? "bg-pal text-white" : "text-ink-muted hover:text-ink"}`}
        >
          {m === "or" ? t("或者") : t("並且")}
        </button>
      ))}
    </div>
  );
}

/** 玩家多選下拉（checkbox）：可搜尋、全選/清除。 */
function OwnerFilter({
  options,
  selected,
  onChange,
}: {
  options: { uid: string; name: string; count: number }[];
  selected: string[];
  onChange: (v: string[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const s = q.trim().toLowerCase();
  const filtered = s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options;
  const toggle = (uid: string) =>
    onChange(selected.includes(uid) ? selected.filter((x) => x !== uid) : [...selected, uid]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-lg bg-card-soft px-2 py-1.5 ring-1 ring-line hover:ring-pal/50 ${selected.length ? "text-pal" : "text-ink"}`}
      >
        👤 {t("玩家")}{selected.length > 0 && <span className="rounded-full bg-pal px-1.5 text-xs text-white">{selected.length}</span>}
        <span className="text-xs text-ink-muted">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg bg-card p-2 shadow-cute ring-1 ring-line">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("搜尋玩家…")}
            className="mb-2 w-full rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:text-sm"
          />
          <div className="mb-1 flex items-center justify-between px-1 text-xs">
            <button onClick={() => onChange(filtered.map((o) => o.uid))} className="text-pal hover:underline">{t("全選")}</button>
            <span className="text-ink-muted">{t("已選 {n}", { n: selected.length })}</span>
            <button onClick={() => onChange([])} className="text-berry hover:underline">{t("清除")}</button>
          </div>
          <div className="max-h-60 overflow-auto">
            {filtered.map((o) => (
              <label key={o.uid} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-card-soft">
                <input type="checkbox" checked={selected.includes(o.uid)} onChange={() => toggle(o.uid)} />
                <span className="flex-1 truncate text-ink">{o.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">{o.count}</span>
              </label>
            ))}
            {filtered.length === 0 && <div className="px-1 py-2 text-center text-xs text-ink-muted">{t("無符合玩家")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function PalBrowser({
  pals,
  showOwner = false,
  onPalClick,
  initialTrait,
  initialWork,
  initialQuery,
  initialKind,
  initialIvTier,
}: {
  pals: OwnedPal[];
  showOwner?: boolean;
  onPalClick: (p: Pal, owner?: Player) => void;
  initialTrait?: string; // 由帕魯詳情跳轉帶入的詞條/技能篩選
  initialWork?: string; // 由帕魯詳情跳轉帶入的工作適性篩選
  initialQuery?: string; // 由帕魯詳情點帕魯名跳轉帶入的名稱搜尋（查同種帕魯）
  initialKind?: string; // 由排行榜跳轉帶入的類型篩選（alpha / lucky / normal）
  initialIvTier?: string; // 由排行榜跳轉帶入的個體值門檻（如 "300" = 完美）
}): JSX.Element {
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [q, setQ] = useState(initialQuery ?? "");
  const [elements, setElements] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>(initialTrait ? [initialTrait] : []); // 詞條/技能多選
  const [traitInput, setTraitInput] = useState("");
  const [traitMode, setTraitMode] = useState<"or" | "and">("or");
  const [ranks, setRanks] = useState<number[]>([]); // 星級多選（精確）
  const [gender, setGender] = useState("");
  const [works, setWorks] = useState<string[]>(initialWork ? [initialWork] : []);
  const [workMode, setWorkMode] = useState<"or" | "and">("and");
  const [ivTier, setIvTier] = useState(initialIvTier ?? "");
  const [levelMin, setLevelMin] = useState("");
  const [kind, setKind] = useState(initialKind ?? "");
  const [namedOnly, setNamedOnly] = useState(false);
  const [owners, setOwners] = useState<string[]>([]); // 持有玩家 uid 多選

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleRank = (n: number) =>
    setRanks((r) => (r.includes(n) ? r.filter((x) => x !== n) : [...r, n]));
  const addTrait = (v: string) => {
    const t = v.trim();
    if (t && !traits.includes(t)) setTraits([...traits, t]);
    setTraitInput("");
  };
  const resetFilters = () => {
    setQ(""); setElements([]); setTraits([]); setTraitInput(""); setRanks([]); setGender("");
    setWorks([]); setIvTier(""); setLevelMin(""); setKind(""); setNamedOnly(false); setOwners([]);
  };
  const selCls = (v: string) =>
    `rounded-lg bg-card-soft px-2 py-1.5 text-base ring-1 ring-line sm:text-sm ${v ? "text-pal" : "text-ink"}`;

  // 進階篩選預設收合。原本九個控制項(類型/星級/性別/等級/個體值/詞條/暱稱/玩家…)
  // 全部攤在同一列,加上屬性、工作適應性各佔一整列,光是篩選區就吃掉半個畫面,
  // 而且每個控制項長得都一樣,看不出哪些是同一類。改成:平常只留「搜尋 + 排序」,
  // 要調再展開;目前生效了什麼,靠下方「已篩選」膠囊看(那本來就有,只是被埋住)。
  const [showFilters, setShowFilters] = useState(false);

  const ownerOpts = useMemo(() => {
    const m = new Map<string, { uid: string; name: string; count: number }>();
    for (const o of pals) {
      const e = m.get(o.owner.uid) ?? { uid: o.owner.uid, name: o.owner.name, count: 0 };
      e.count++;
      m.set(o.owner.uid, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [pals]);
  const elementOpts = useMemo(() => [...new Set(pals.flatMap((o) => o.pal.elements))].sort(), [pals]);
  const workOpts = useMemo(() => [...new Set(pals.flatMap((o) => Object.keys(o.pal.work)))].sort(), [pals]);
  const traitOpts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of pals)
      for (const t of [...o.pal.passives, ...o.pal.active_skills, ...o.pal.mastered_skills])
        m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pals]);

  const shown = useMemo(() => {
    const sorter = SORTS.find((s) => s.key === sort)!;
    const list = pals.filter(({ pal: p, owner }) => {
      if (owners.length && !owners.includes(owner.uid)) return false;
      if (kind === "alpha" && !p.is_alpha) return false;
      if (kind === "lucky" && !p.is_lucky) return false;
      if (kind === "normal" && (p.is_alpha || p.is_lucky)) return false;
      if (namedOnly && !p.nickname) return false;
      if (elements.length && !p.elements.some((e) => elements.includes(e))) return false;
      if (gender && p.gender !== gender) return false;
      if (ranks.length && !ranks.includes(p.rank)) return false;
      if (levelMin && p.level < Number(levelMin)) return false;
      if (ivTier && ivSum(p) < Number(ivTier)) return false;
      if (works.length) {
        const ok = workMode === "and" ? works.every((w) => (p.work[w] ?? 0) > 0) : works.some((w) => (p.work[w] ?? 0) > 0);
        if (!ok) return false;
      }
      if (traits.length) {
        const hay = [...p.passives, ...p.active_skills, ...p.mastered_skills].map((x) => x.toLowerCase());
        const has = (t: string) => hay.some((x) => x.includes(t.toLowerCase()));
        const ok = traitMode === "and" ? traits.every(has) : traits.some(has);
        if (!ok) return false;
      }
      if (q) {
        const s = q.toLowerCase();
        // 也比對圖鑑正確繁中名（部分帕魯存檔 name_zh 為英文，顯示卻是繁中，否則會查不到）
        const dexZh = (palInfo(p.species).zh || "").toLowerCase();
        if (
          !p.name_zh.toLowerCase().includes(s) &&
          !p.name_en.toLowerCase().includes(s) &&
          !p.nickname.toLowerCase().includes(s) &&
          !dexZh.includes(s)
        )
          return false;
      }
      return true;
    });
    list.sort((a, b) => {
      if (works.length) {
        const wa = Math.max(...works.map((w) => a.pal.work[w] ?? 0));
        const wb = Math.max(...works.map((w) => b.pal.work[w] ?? 0));
        if (wa !== wb) return wb - wa;
      }
      const va = sorter.fn(a.pal);
      const vb = sorter.fn(b.pal);
      const r = typeof va === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return dir === "desc" ? -r : r;
    });
    return list;
  }, [pals, sort, dir, q, elements, traits, traitMode, ranks, gender, works, workMode, ivTier, levelMin, kind, namedOnly, owners]);

  // 無限捲動：每次顯示 BATCH 張，捲到底載更多；篩選/排序改變時重置。
  const [visible, setVisible] = useState(BATCH);
  useEffect(() => { setVisible(BATCH); }, [shown]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisible((v) => Math.min(v + BATCH, shown.length)); },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  const shownCount = Math.min(visible, shown.length);

  // 目前生效的篩選 →「已篩選」可移除膠囊。
  // 篩選面板收合後,這排膠囊就是唯一看得到「現在篩了什麼」的地方,
  // 所以每一種條件都必須列進來(以前屬性與詞條靠自己那列的高亮表示,現在那列會被收起來)。
  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (q) activeChips.push({ key: "q", label: `🔍 ${q}`, onClear: () => setQ("") });
  elements.forEach((e) => activeChips.push({ key: `el${e}`, label: e, onClear: () => toggle(elements, setElements, e) }));
  traits.forEach((tr) => activeChips.push({ key: `tr${tr}`, label: localizeTrait(tr), onClear: () => setTraits(traits.filter((x) => x !== tr)) }));
  if (kind) activeChips.push({ key: "kind", label: kind === "alpha" ? t("α / 首領") : kind === "lucky" ? t("✦ 稀有") : t("一般"), onClear: () => setKind("") });
  [...ranks].sort((a, b) => b - a).forEach((n) => activeChips.push({ key: `rank${n}`, label: `★${n}`, onClear: () => toggleRank(n) }));
  if (gender) activeChips.push({ key: "gender", label: gender === "Male" ? t("♂ 公") : t("♀ 母"), onClear: () => setGender("") });
  if (levelMin) activeChips.push({ key: "lv", label: `Lv ≥ ${levelMin}`, onClear: () => setLevelMin("") });
  if (ivTier) activeChips.push({ key: "iv", label: ivTier === "300" ? t("完美 (IV 300)") : t("IV 總和 ≥ {n}", { n: ivTier }), onClear: () => setIvTier("") });
  works.forEach((w) => activeChips.push({ key: `work${w}`, label: `🔨 ${localizeWork(w)}`, onClear: () => toggle(works, setWorks, w) }));
  if (namedOnly) activeChips.push({ key: "named", label: t("有暱稱"), onClear: () => setNamedOnly(false) });
  owners.forEach((uid) => {
    const o = ownerOpts.find((x) => x.uid === uid);
    activeChips.push({ key: `own${uid}`, label: `👤 ${o?.name ?? uid}`, onClear: () => toggle(owners, setOwners, uid) });
  });

  return (
    <div>
      <div className="mb-2 space-y-2 text-sm">
        {/* 常駐列:只留最常用的兩件事 —— 找名字、換排序。其餘收進「篩選」。 */}
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("🔍 搜尋帕魯名/暱稱…")}
            className="min-w-48 flex-1 rounded-lg bg-card-soft px-3 py-1.5 text-base text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:text-sm" />
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
              showFilters || activeChips.length
                ? "bg-pal/15 text-pal ring-pal/40 hover:bg-pal/25"
                : "bg-card-soft text-ink ring-line hover:ring-pal/50"
            }`}
          >
            ⚙ {t("篩選")}
            {/* 收合狀態下也要看得出「有在篩」,不然會以為資料變少是壞掉了 */}
            {activeChips.length > 0 && (
              <span className="rounded-full bg-pal px-1.5 text-xs font-bold text-white">{activeChips.length}</span>
            )}
            <span className="text-xs text-ink-muted">{showFilters ? "▲" : "▼"}</span>
          </button>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink ring-1 ring-line sm:text-sm">
            {SORTS.map((s) => (<option key={s.key} value={s.key}>{t(s.label)}</option>))}
          </select>
          <button onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
            title={dir === "desc" ? t("▼ 降序") : t("▲ 升序")}
            className="rounded-lg bg-card-soft px-2.5 py-1.5 text-sm text-ink ring-1 ring-line hover:ring-pal">
            {dir === "desc" ? "▼" : "▲"}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-3 rounded-xl bg-card-soft/60 p-3 ring-1 ring-line">
            <FilterRow label={t("基本")}>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={selCls(kind)}>
                <option value="">{t("全部類型")}</option>
                <option value="alpha">{t("α / 首領")}</option>
                <option value="lucky">{t("✦ 稀有")}</option>
                <option value="normal">{t("一般")}</option>
              </select>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={selCls(gender)}>
                <option value="">{t("全部性別")}</option>
                <option value="Male">{t("♂ 公")}</option>
                <option value="Female">{t("♀ 母")}</option>
              </select>
              <select value={levelMin} onChange={(e) => setLevelMin(e.target.value)} className={selCls(levelMin)}>
                <option value="">{t("全部等級")}</option>
                {[50, 40, 30, 20, 10].map((n) => (<option key={n} value={n}>Lv ≥ {n}</option>))}
              </select>
              <select value={ivTier} onChange={(e) => setIvTier(e.target.value)} className={selCls(ivTier)}>
                <option value="">{t("全部個體值")}</option>
                <option value="300">{t("完美 (300)")}</option>
                <option value="270">{t("總和 ≥ 270")}</option>
                <option value="240">{t("總和 ≥ 240")}</option>
                <option value="180">{t("總和 ≥ 180")}</option>
              </select>
              <label className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ring-1 transition ${
                namedOnly ? "bg-pal/15 text-pal ring-pal/40" : "bg-card-soft text-ink ring-line hover:ring-pal/50"
              }`}>
                <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
                {t("只看有暱稱")}
              </label>
              {showOwner && ownerOpts.length > 1 && (
                <OwnerFilter options={ownerOpts} selected={owners} onChange={setOwners} />
              )}
            </FilterRow>

            <FilterRow label={t("星級")}>
              {[5, 4, 3, 2, 1].map((n) => (
                <button
                  key={n}
                  onClick={() => toggleRank(n)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
                    ranks.includes(n) ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink-muted ring-line hover:text-ink hover:ring-pal/50"
                  }`}
                  title={t("{n} 星", { n })}
                >
                  ★{n}
                </button>
              ))}
            </FilterRow>

            {elementOpts.length > 0 && (
              <FilterRow label={t("屬性")}>
                {elementOpts.map((e) => {
                  const on = elements.includes(e);
                  return (
                    <button key={e} onClick={() => toggle(elements, setElements, e)}
                      className={`rounded-full ring-2 transition ${on ? "ring-pal ring-offset-1" : "opacity-60 ring-transparent hover:opacity-100"}`}>
                      <ElementBadge el={e} size="lg" />
                    </button>
                  );
                })}
              </FilterRow>
            )}

            {workOpts.length > 0 && (
              <FilterRow label={t("工作適應性")}>
                {workOpts.map((w) => {
                  const on = works.includes(w);
                  return (
                    <button key={w} onClick={() => toggle(works, setWorks, w)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold ring-1 transition ${on ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink ring-line hover:ring-pal/50"}`}>
                      <WorkIcon work={w} size={18} />{localizeWork(w)}
                    </button>
                  );
                })}
                {works.length > 1 && <ModeToggle mode={workMode} onChange={setWorkMode} />}
              </FilterRow>
            )}

            <FilterRow label={t("詞條/技能")}>
              <input
                value={traitInput}
                onChange={(e) => {
                  const v = e.target.value;
                  // 從 datalist 選到既有詞條 → 直接加入
                  if (traitOpts.some(([name]) => name === v)) addTrait(v);
                  else setTraitInput(v);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrait(traitInput); } }}
                list="pb-traits"
                placeholder={t("輸入以新增…（可多選）")}
                className={`w-48 max-w-full rounded-lg bg-card-soft px-3 py-1.5 text-base outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:text-sm ${traits.length ? "text-pal" : "text-ink"}`}
              />
              <datalist id="pb-traits">
                {traitOpts.map(([name, n]) => (<option key={name} value={name}>{localizeTrait(name)}（{n}）</option>))}
              </datalist>
              {traits.map((tr) => (
                <button
                  key={tr}
                  onClick={() => setTraits(traits.filter((x) => x !== tr))}
                  title={t("移除此詞條")}
                  className="flex items-center gap-1 rounded-full bg-pal px-2.5 py-1 text-xs text-white ring-1 ring-pal hover:bg-pal/80"
                >
                  {localizeTrait(tr)}<span className="text-white/80">✕</span>
                </button>
              ))}
              {traits.length > 1 && <ModeToggle mode={traitMode} onChange={setTraitMode} />}
            </FilterRow>
          </div>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-bold text-ink-muted">{t("已篩選")}</span>
          {activeChips.map((c) => (
            <button
              key={c.key}
              onClick={c.onClear}
              title={t("取消此篩選")}
              className="flex items-center gap-1 rounded-full bg-pal px-2.5 py-1 text-xs font-bold text-white ring-1 ring-pal transition hover:bg-pal/80"
            >
              {c.label}
              <span className="text-white/80">✕</span>
            </button>
          ))}
          <button onClick={resetFilters} className="ml-1 text-xs text-ink-muted underline underline-offset-2 hover:text-ink">
            {t("全部清除")}
          </button>
        </div>
      )}
      <div className="mb-2 text-xs text-ink-muted">
        {t("顯示 {shown} / {total} 隻（共 {all}）", { shown: shownCount, total: shown.length, all: pals.length })}
        {shownCount < shown.length && t("，往下捲動載入更多…")}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.slice(0, shownCount).map(({ pal, owner }, i) => (
          <PalTile key={i} pal={pal} owner={showOwner ? owner.name : undefined} onClick={() => onPalClick(pal, owner)} />
        ))}
      </div>
      {/* 捲動哨兵：進入視窗即載入下一批 */}
      {shownCount < shown.length && <div ref={sentinelRef} className="h-10" aria-hidden="true" />}
    </div>
  );
}
