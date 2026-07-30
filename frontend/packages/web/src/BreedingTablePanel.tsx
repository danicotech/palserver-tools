import { useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import { FiCornerUpLeft, FiList, FiRepeat, FiSearch, FiStar } from "react-icons/fi";
import { GiEggClutch } from "react-icons/gi";
import { EntityPicker } from "./EntityPicker";
import { displayName, palIconUrl, type GameData, type GameEntity } from "./gameData";
import type { BreedingData, BreedingGender, BreedingRecipe } from "./breedingSolver";
import {
  buildBreedingIndex,
  lookupPair,
  parentsOf,
  partnersOf,
  rareChildren,
  type BreedingTableIndex,
} from "./breedingTable";
import { t, useI18n } from "./i18n";
import { EmptyState, btnGhost, card, inputCls, labelCls, Select } from "./ui";

/** 一次顯示的列數;反查最多會有 1280 列,分批渲染避免一次塞爆 DOM。 */
const PAGE_SIZE = 60;

type Mode = "pair" | "child" | "parent" | "rare";

const MODES: { id: Mode; label: string; icon: JSX.Element }[] = [
  { id: "pair", label: "正查:父母 → 子代", icon: <FiSearch className="size-4" /> },
  { id: "child", label: "反查:子代 → 父母", icon: <FiCornerUpLeft className="size-4" /> },
  { id: "parent", label: "單親全表", icon: <FiList className="size-4" /> },
  { id: "rare", label: "稀有配方", icon: <FiStar className="size-4" /> },
];

function genderMark(g: BreedingGender): string {
  return g === "m" ? "♂" : g === "f" ? "♀" : "♂/♀";
}

/** 帕魯圖示 + 名稱;找不到圖鑑資料時退回顯示內部 id,不留空白。 */
function PalChip({
  id,
  gameData,
  gender,
  onClick,
  dim,
}: {
  id: string;
  gameData: GameData | null;
  gender?: BreedingGender;
  onClick?: () => void;
  dim?: boolean;
}) {
  const entity = gameData?.palByIdLower.get(id.toLowerCase());
  const label = entity ? displayName(entity) : id;
  const body = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-line bg-card-soft">
        {entity?.icon && <img src={palIconUrl(entity.icon)} alt="" loading="lazy" className="size-full object-contain" />}
      </span>
      <span className="truncate text-[13px] font-bold">{label}</span>
      {gender && gender !== "*" && <span className="shrink-0 text-xs text-ink-muted">{genderMark(gender)}</span>}
    </>
  );
  if (!onClick) {
    return (
      <span className={`flex min-w-0 items-center gap-1.5 ${dim ? "text-ink-muted" : ""}`} title={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("查看 {name} 的配方", { name: label })}
      className={`flex min-w-0 items-center gap-1.5 rounded-md text-left transition hover:text-pal ${dim ? "text-ink-muted" : ""}`}
    >
      {body}
    </button>
  );
}

/** 四語 + 內部 id 的寬鬆比對,和 EntityPicker 的搜尋行為一致。 */
function makeMatcher(query: string, gameData: GameData | null): (id: string) => boolean {
  const raw = query.trim();
  if (!raw) return () => true;
  const lower = raw.toLowerCase();
  return (id: string) => {
    const e = gameData?.palByIdLower.get(id.toLowerCase());
    if (id.toLowerCase().includes(lower)) return true;
    if (!e) return false;
    return (
      e.name.toLowerCase().includes(lower) ||
      Boolean(e.zh?.includes(raw)) ||
      Boolean(e["zh-CN"]?.includes(raw)) ||
      Boolean(e.zhCN?.includes(raw)) ||
      Boolean(e.ja?.includes(raw))
    );
  };
}

/** 分批顯示 + 「顯示更多」;切換查詢條件時由呼叫端用 key 重置。 */
function usePaged<T>(rows: T[]): { shown: T[]; more: number; showMore: () => void } {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [rows]);
  return {
    shown: rows.slice(0, limit),
    more: Math.max(0, rows.length - limit),
    showMore: () => setLimit((n) => n + PAGE_SIZE * 4),
  };
}

function RowShell({ children }: { children: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 odd:bg-card-soft/40 sm:gap-3">
      {children}
    </li>
  );
}

function MoreButton({ more, onClick }: { more: number; onClick: () => void }) {
  if (more <= 0) return null;
  return (
    <div className="flex justify-center p-3">
      <button type="button" className={btnGhost} onClick={onClick}>
        {t("顯示更多(還有 {n} 筆)", { n: more })}
      </button>
    </div>
  );
}

export function BreedingTablePanel({
  data,
  gameData,
  initialMode = "pair",
}: {
  data: BreedingData;
  gameData: GameData | null;
  initialMode?: Mode;
}) {
  useI18n();
  const index = useMemo<BreedingTableIndex>(() => buildBreedingIndex(data), [data]);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [parentA, setParentA] = useState("");
  const [parentB, setParentB] = useState("");
  const [childId, setChildId] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"child" | "partner">("child");

  /** 選單只放 299 隻可配種帕魯 —— 圖鑑裡的世界樹龍/塔王變體無法配種,選了只會得到空結果。 */
  const breedableCatalog = useMemo<GameEntity[]>(() => {
    const pals = gameData?.pals ?? [];
    const known = pals.filter((p) => index.speciesSet.has(p.id));
    const knownIds = new Set(known.map((p) => p.id));
    // 圖鑑缺漏的物種仍要能選到,補成 id-only 條目。
    const extras = index.species.filter((id) => !knownIds.has(id)).map((id) => ({ id, name: id }));
    return [...known, ...extras];
  }, [gameData, index]);

  const nameOf = (id: string) => {
    const e = gameData?.palByIdLower.get(id.toLowerCase());
    return e ? displayName(e) : id;
  };
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b));
  const matcher = useMemo(() => makeMatcher(query, gameData), [query, gameData]);

  // ---- 正查 ----
  const pairOutcomes = useMemo(
    () => (parentA && parentB ? lookupPair(index, parentA, parentB) : []),
    [index, parentA, parentB],
  );

  // ---- 反查 ----
  const childRecipes = useMemo(() => {
    if (!childId) return [];
    const rows = parentsOf(index, childId).map(([p1, g1, p2, g2]): BreedingRecipe => [p1, g1, p2, g2, childId]);
    return rows
      .filter(([p1, , p2]) => matcher(p1) || matcher(p2))
      .sort(([a1], [b1]) => byName(a1, b1));
  }, [index, childId, matcher, gameData]);

  // ---- 單親全表 ----
  const parentRows = useMemo(() => {
    if (!parentA) return [];
    return partnersOf(index, parentA)
      .filter((row) => matcher(row.partner) || matcher(row.child))
      .sort((x, y) =>
        sortBy === "child"
          ? byName(x.child, y.child) || byName(x.partner, y.partner)
          : byName(x.partner, y.partner),
      );
  }, [index, parentA, matcher, sortBy, gameData]);

  // ---- 稀有配方 ----
  const rareRows = useMemo(
    () => rareChildren(index, 3).filter((r) => matcher(r.child)),
    [index, matcher, gameData],
  );

  const pagedChild = usePaged(childRecipes);
  const pagedParent = usePaged(parentRows);
  const pagedRare = usePaged(rareRows);

  const gotoChild = (id: string) => {
    setChildId(id);
    setQuery("");
    setMode("child");
  };
  const gotoParent = (id: string) => {
    setParentA(id);
    setQuery("");
    setMode("parent");
  };

  const { stats } = index;
  const complete = stats.pairCount === stats.expectedPairCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id);
              setQuery("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-[13px] font-extrabold transition ${
              mode === m.id
                ? "border-pal bg-pal/10 text-pal"
                : "border-line bg-card-soft text-ink-muted hover:border-pal"
            }`}
          >
            {m.icon} {t(m.label)}
          </button>
        ))}
      </div>

      {/* ---------------- 正查 ---------------- */}
      {mode === "pair" && (
        <>
          <div className={`${card} grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end`}>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("父母一")}</span>
              <EntityPicker
                catalog={breedableCatalog}
                iconUrl={palIconUrl}
                value={parentA}
                onChange={setParentA}
                placeholder={t("搜尋帕魯…")}
              />
            </label>
            <button
              type="button"
              className={`${btnGhost} !px-3 justify-self-center`}
              title={t("交換父母")}
              aria-label={t("交換父母")}
              onClick={() => {
                setParentA(parentB);
                setParentB(parentA);
              }}
            >
              <FiRepeat className="size-4" />
            </button>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("父母二")}</span>
              <EntityPicker
                catalog={breedableCatalog}
                iconUrl={palIconUrl}
                value={parentB}
                onChange={setParentB}
                placeholder={t("搜尋帕魯…")}
              />
            </label>
          </div>

          {!parentA || !parentB ? (
            <EmptyState icon={<GiEggClutch />} title={t("選擇兩隻父母")}>
              {t("配種表已涵蓋 {n} 隻可配種帕魯的全部組合,任兩隻都查得到結果。", { n: stats.speciesCount })}
            </EmptyState>
          ) : pairOutcomes.length === 0 ? (
            <EmptyState icon={<GiEggClutch />} title={t("查無這組配方")}>
              {t("這兩隻在配種表中沒有對應資料。")}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {pairOutcomes.length > 1 && (
                <p className="rounded-xl bg-sun/10 px-3 py-2 text-[13px] font-bold text-ink">
                  {t("這組父母會依性別生出不同子代,兩種結果都列在下面。")}
                </p>
              )}
              {pairOutcomes.map((outcome, i) => (
                <div key={i} className={`${card} flex flex-col items-center gap-3 sm:flex-row sm:justify-center`}>
                  <PalChip id={parentA} gameData={gameData} gender={outcome.genderA} />
                  <span className="text-lg font-extrabold text-ink-muted">×</span>
                  <PalChip id={parentB} gameData={gameData} gender={outcome.genderB} />
                  <span className="text-lg font-extrabold text-pal">→</span>
                  <span className="flex items-center gap-2 rounded-full border-2 border-pal bg-pal/10 px-3 py-1.5">
                    <PalChip id={outcome.child} gameData={gameData} />
                  </span>
                  <div className="flex gap-1.5 sm:ml-2">
                    <button type="button" className={`${btnGhost} !px-3 !py-1.5 !text-xs`} onClick={() => gotoChild(outcome.child)}>
                      {t("反查")}
                    </button>
                    <button type="button" className={`${btnGhost} !px-3 !py-1.5 !text-xs`} onClick={() => gotoParent(outcome.child)}>
                      {t("全表")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------------- 反查 ---------------- */}
      {mode === "child" && (
        <>
          <div className={`${card} grid gap-4 md:grid-cols-2`}>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("目標子代")}</span>
              <EntityPicker
                catalog={breedableCatalog}
                iconUrl={palIconUrl}
                value={childId}
                onChange={setChildId}
                placeholder={t("搜尋想生出的帕魯…")}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("篩選父母名稱")}</span>
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("只顯示含此名稱的組合…")}
              />
            </label>
          </div>

          {!childId ? (
            <EmptyState icon={<GiEggClutch />} title={t("選擇目標子代")}>
              {t("選一隻帕魯,列出所有能生出牠的父母組合。")}
            </EmptyState>
          ) : childRecipes.length === 0 ? (
            <EmptyState icon={<GiEggClutch />} title={t("沒有符合的組合")}>
              {query ? t("清空篩選條件再試一次。") : t("配種表中沒有能生出牠的組合。")}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-(--radius-cute) border-2 border-line bg-card">
              <p className="border-b-2 border-line bg-card-soft px-3 py-2 text-[13px] font-extrabold">
                {t("{name} 共 {n} 種父母組合", { name: nameOf(childId), n: childRecipes.length })}
              </p>
              <ul>
                {pagedChild.shown.map(([p1, g1, p2, g2], i) => (
                  <RowShell key={`${p1}-${p2}-${i}`}>
                    <PalChip id={p1} gameData={gameData} gender={g1} onClick={() => gotoParent(p1)} />
                    <span className="text-xs font-extrabold text-ink-muted">×</span>
                    <PalChip id={p2} gameData={gameData} gender={g2} onClick={() => gotoParent(p2)} />
                  </RowShell>
                ))}
              </ul>
              <MoreButton more={pagedChild.more} onClick={pagedChild.showMore} />
            </div>
          )}
        </>
      )}

      {/* ---------------- 單親全表 ---------------- */}
      {mode === "parent" && (
        <>
          <div className={`${card} grid gap-4 md:grid-cols-3`}>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("父母一")}</span>
              <EntityPicker
                catalog={breedableCatalog}
                iconUrl={palIconUrl}
                value={parentA}
                onChange={setParentA}
                placeholder={t("搜尋帕魯…")}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("篩選夥伴或子代名稱")}</span>
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("只顯示含此名稱的列…")}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("排序")}</span>
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as "child" | "partner")}>
                <option value="child">{t("依子代名稱")}</option>
                <option value="partner">{t("依夥伴名稱")}</option>
              </Select>
            </label>
          </div>

          {!parentA ? (
            <EmptyState icon={<GiEggClutch />} title={t("選擇一隻父母")}>
              {t("列出牠與全部 {n} 隻(含自己)配種的結果。", { n: stats.speciesCount })}
            </EmptyState>
          ) : parentRows.length === 0 ? (
            <EmptyState icon={<GiEggClutch />} title={t("沒有符合的列")}>
              {t("清空篩選條件再試一次。")}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-(--radius-cute) border-2 border-line bg-card">
              <p className="border-b-2 border-line bg-card-soft px-3 py-2 text-[13px] font-extrabold">
                {t("{name} × 夥伴 → 子代 · {n} 列", { name: nameOf(parentA), n: parentRows.length })}
              </p>
              <ul>
                {pagedParent.shown.map((row, i) => (
                  <RowShell key={`${row.partner}-${i}`}>
                    <PalChip
                      id={row.partner}
                      gameData={gameData}
                      gender={row.genderB}
                      dim={row.partner === parentA}
                      onClick={() => gotoParent(row.partner)}
                    />
                    <span className="text-xs font-extrabold text-pal">→</span>
                    <PalChip id={row.child} gameData={gameData} onClick={() => gotoChild(row.child)} />
                  </RowShell>
                ))}
              </ul>
              <MoreButton more={pagedParent.more} onClick={pagedParent.showMore} />
            </div>
          )}
        </>
      )}

      {/* ---------------- 稀有配方 ---------------- */}
      {mode === "rare" && (
        <>
          <div className={`${card} grid gap-4 md:grid-cols-2`}>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>{t("篩選子代名稱")}</span>
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("搜尋子代…")}
              />
            </label>
            <p className="self-end text-[13px] text-ink-muted">
              {t("只列出 3 種以內組合就能生出的帕魯 —— 幾乎都是傳說帕魯的專屬配方。")}
            </p>
          </div>

          {rareRows.length === 0 ? (
            <EmptyState icon={<GiEggClutch />} title={t("沒有符合的子代")}>
              {t("清空篩選條件再試一次。")}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {pagedRare.shown.map((row) => (
                <div key={row.child} className={`${card} flex flex-col gap-2`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-2 rounded-full border-2 border-pal bg-pal/10 px-3 py-1.5">
                      <PalChip id={row.child} gameData={gameData} />
                    </span>
                    <span className="rounded-full bg-card-soft px-2.5 py-1 text-[11px] font-extrabold text-ink-muted">
                      {t("{n} 種組合", { n: row.recipes.length })}
                    </span>
                    {row.recipes.every(([p1, , p2]) => p1 === row.child && p2 === row.child) && (
                      <span
                        className="rounded-full bg-sun/15 px-2.5 py-1 text-[11px] font-extrabold text-ink"
                        title={t("沒有任何其他物種的組合能生出牠,只能用兩隻同種配種")}
                      >
                        {t("只能同種配種")}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`${btnGhost} ml-auto !px-3 !py-1.5 !text-xs`}
                      onClick={() => gotoChild(row.child)}
                    >
                      {t("反查")}
                    </button>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {row.recipes.map(([p1, g1, p2, g2], i) => (
                      <li key={`${p1}-${p2}-${i}`} className="flex min-w-0 flex-wrap items-center gap-2">
                        <PalChip id={p1} gameData={gameData} gender={g1} onClick={() => gotoParent(p1)} />
                        <span className="text-xs font-extrabold text-ink-muted">×</span>
                        <PalChip id={p2} gameData={gameData} gender={g2} onClick={() => gotoParent(p2)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <MoreButton more={pagedRare.more} onClick={pagedRare.showMore} />
            </div>
          )}
        </>
      )}

      <p className="text-center text-[11px] text-ink-muted">
        {complete
          ? t("配種表:{species} 隻可配種帕魯 · {pairs} 組配對全覆蓋 · {recipes} 筆配方(含 {split} 組性別分歧)", {
              species: stats.speciesCount,
              pairs: stats.pairCount,
              recipes: stats.recipeCount,
              split: stats.genderSplitCount,
            })
          : t("配種表:{species} 隻帕魯 · 已收錄 {pairs}/{expected} 組配對", {
              species: stats.speciesCount,
              pairs: stats.pairCount,
              expected: stats.expectedPairCount,
            })}
      </p>
    </div>
  );
}
