// 「配種表」分頁:純靜態查表(breeding.json,palcalc MIT 資料),不依賴存檔資料集。
// UI 參考 palworld.gg / palbreed.com / op.gg 的配種工具重構:
//   插槽(A + B = C)+ 永遠可見的卡片網格 —— 點卡片填入作用中插槽,不用下拉選單。
// 四種模式:配種計算(正查)、反查組合(作為子代/作為父母)、路徑金字塔、稀有配方。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { solveBreeding, type BreedingData, type BreedingGender, type BreedingNode, type BreedingSolution } from "../breedingSolver";
import type { SaveBreedingPal } from "@palserver/shared";
import {
  buildBreedingIndex,
  edgeOptions,
  isSelfOnlyChild,
  lookupPair,
  parentsOf,
  partnersOf,
  solveChain,
  stepChildren,
  type BreedingTableIndex,
  type ChainRoute,
  type ChainStep,
} from "../breedingTable";
import {
  buildMutationIndex,
  findMutationPairs,
  mutationOutcomes,
  requiredParentAvg,
  eggsForConfidence,
  eggsToSeconds,
  humanDuration,
  CAKES,
  FARMS,
  MUTATION_PERKS,
  MUTATION_PASSIVES,
  MUTATION_RATE,
  type CakeKind,
  type FarmKind,
  type MutationData,
  type MutationIndex,
  type MutationPair,
} from "../mutationTable";
import { loadPaldex, palInfo } from "./paldex";
import { BreedingTreeView, ElementDot, EL_COLORS } from "./BreedingTreeView";
import type { Dataset } from "./data";
import { t, useI18n } from "../i18n";

/** 一次顯示的列數;反查最多會有 1280 列,分批渲染避免一次塞爆 DOM。 */
const PAGE_SIZE = 40;

// ---------------------------------------------------------------------------
// 靜態資料載入
// ---------------------------------------------------------------------------

type Mode = "pair" | "reverse" | "chain" | "mutation";

interface PalMeta {
  el: string[];
  deck: number;
  r: number;
}

let breedingCache: Promise<BreedingData> | null = null;
function loadBreeding(): Promise<BreedingData> {
  if (!breedingCache) {
    breedingCache = fetch("/game-data/breeding.json").then((r) => {
      if (!r.ok) throw new Error(`breeding.json: HTTP ${r.status}`);
      return r.json() as Promise<BreedingData>;
    });
    breedingCache.catch(() => {
      breedingCache = null; // 失敗不快取,重進分頁可重試
    });
  }
  return breedingCache;
}

let mutationCache: Promise<MutationData | null> | null = null;
function loadMutation(): Promise<MutationData | null> {
  // 變異資料是加值功能,抓不到就讓變異分頁顯示提示,不影響其他模式。
  if (!mutationCache)
    mutationCache = fetch("/game-data/mutation.json")
      .then((r) => (r.ok ? (r.json() as Promise<MutationData>) : null))
      .catch(() => null);
  return mutationCache;
}

let metaCache: Promise<Record<string, PalMeta>> | null = null;
function loadMeta(): Promise<Record<string, PalMeta>> {
  // 屬性/圖鑑編號/稀有度是加分資訊,拿不到就給空物件,不擋整頁。
  if (!metaCache) metaCache = fetch("/game-data/pal-meta.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return metaCache;
}

// ---------------------------------------------------------------------------
// 小元件
// ---------------------------------------------------------------------------

/** 稀有度分級(palworld.gg 的 普通/稀有/史詩/傳說 徽章)。 */
function rarityTier(r: number): { label: string; cls: string } | null {
  if (!r) return null;
  if (r >= 11) return { label: "傳說", cls: "text-sun ring-sun/50" };
  if (r >= 9) return { label: "史詩", cls: "text-sponsor ring-sponsor/50" };
  if (r >= 5) return { label: "稀有", cls: "text-pal ring-pal/50" };
  return { label: "普通", cls: "text-ink-muted ring-line" };
}

/** 帕魯卡片(網格用):屬性角標 + 頭像 + 名稱 + 稀有度。 */
function PalCard({
  id,
  meta,
  selected,
  onClick,
}: {
  id: string;
  meta?: PalMeta;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  const info = palInfo(id);
  const tier = rarityTier(meta?.r ?? 0);
  return (
    <button
      type="button"
      onClick={onClick}
      title={info.zh || id}
      className={`relative flex min-h-30 flex-col items-center justify-start gap-1 rounded-xl bg-card p-2 pt-3 text-center ring-1 transition hover:-translate-y-px hover:ring-pal ${
        selected ? "ring-2 ring-pal" : "ring-line"
      }`}
    >
      <span className="absolute top-1.5 left-1.5 flex flex-col gap-0.5">
        {(meta?.el ?? []).map((e) => (
          <ElementDot key={e} el={e} />
        ))}
      </span>
      {meta && meta.deck > 0 && (
        <span className="absolute top-1.5 right-1.5 text-[11px] tabular-nums text-ink-muted">#{meta.deck}</span>
      )}
      {info.iconUrl ? (
        <img src={info.iconUrl} alt="" loading="lazy" className="size-13 rounded-full bg-card-soft ring-1 ring-line" />
      ) : (
        <span className="flex size-13 items-center justify-center rounded-full bg-card-soft text-lg ring-1 ring-line">❓</span>
      )}
      <span className="w-full truncate text-[13px] font-semibold text-ink">{info.zh || id}</span>
      {tier && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tier.cls}`}>{t(tier.label)}</span>
      )}
    </button>
  );
}

/** 插槽:空 = 虛線框「點此選擇」;填入後顯示帕魯;作用中亮主題色。 */
function SlotCard({
  role,
  id,
  meta,
  active,
  accent,
  onActivate,
  onClear,
}: {
  role: string;
  id: string;
  meta?: PalMeta;
  active: boolean;
  /** 結果插槽風格(金黃描邊,不可點) */
  accent?: boolean;
  onActivate?: () => void;
  onClear?: () => void;
}): JSX.Element {
  const info = id ? palInfo(id) : null;
  const ring = accent
    ? "border-2 border-sun"
    : active
      ? "border-2 border-pal shadow-cute"
      : id
        ? "border-2 border-line"
        : "border-2 border-dashed border-line";
  const inner = (
    <>
      <span className="text-[11px] font-semibold tracking-wide text-ink-muted">{role}</span>
      {info ? (
        <>
          <span className="relative">
            <img src={info.iconUrl} alt="" className="size-12 rounded-full bg-card-soft ring-1 ring-line sm:size-14" />
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
              {(meta?.el ?? []).map((e) => (
                <ElementDot key={e} el={e} />
              ))}
            </span>
          </span>
          <span className="w-full truncate px-1 text-sm font-bold text-ink">{info.zh || id}</span>
        </>
      ) : (
        <>
          <span className={`flex size-12 items-center justify-center rounded-full text-xl sm:size-14 ${accent ? "text-sun" : "text-ink-muted"}`}>
            {accent ? "❓" : "➕"}
          </span>
          <span className="text-xs text-ink-muted">{accent ? t("結果") : t("點此選擇")}</span>
        </>
      )}
    </>
  );
  if (accent) {
    return <div className={`relative flex h-32 w-full flex-col items-center justify-center gap-1 rounded-cute bg-card px-1 ${ring}`}>{inner}</div>;
  }
  return (
    <div className={`relative h-32 w-full rounded-cute bg-card ${ring}`}>
      <button type="button" onClick={onActivate} className="flex size-full flex-col items-center justify-center gap-1 px-1">
        {inner}
      </button>
      {id && onClear && (
        <button
          type="button"
          aria-label={t("清除")}
          onClick={onClear}
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full text-ink-muted transition hover:bg-card-soft hover:text-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** 迷你帕魯(組合列 / 金字塔夥伴用)。 */
function PalChip({
  id,
  gender,
  onClick,
  highlight,
  gray,
}: {
  id: string;
  gender?: BreedingGender;
  onClick?: () => void;
  highlight?: boolean;
  /** 玩家缺這隻 → 灰階頭像 */
  gray?: boolean;
}): JSX.Element {
  const info = palInfo(id);
  const label = info.zh || id;
  const mark = gender === "m" ? "♂" : gender === "f" ? "♀" : "";
  const inner = (
    <>
      {info.iconUrl && (
        <img
          src={info.iconUrl}
          alt=""
          loading="lazy"
          className={`size-7 shrink-0 rounded-full bg-card-soft ring-1 ring-line ${gray ? "opacity-70 grayscale" : ""}`}
        />
      )}
      <span className="truncate text-[13px] font-medium">{label}</span>
      {mark && <span className="shrink-0 text-xs text-ink-muted">{mark}</span>}
    </>
  );
  const base = "flex min-w-0 items-center gap-1.5";
  if (!onClick)
    return (
      <span className={`${base} ${highlight ? "rounded-full bg-pal/15 px-2.5 py-1 ring-1 ring-pal/40" : ""}`} title={label}>
        {inner}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`${base} rounded-full text-left transition hover:text-pal ${highlight ? "bg-pal/15 px-2.5 py-1 ring-1 ring-pal/40" : ""}`}
    >
      {inner}
    </button>
  );
}

/** 組合列:A + B = C(palworld.gg 右欄樣式)。 */
function ComboRow({
  a,
  ga,
  b,
  gb,
  c,
  onPick,
}: {
  a: string;
  ga?: BreedingGender;
  b: string;
  gb?: BreedingGender;
  c: string;
  onPick: (id: string) => void;
}): JSX.Element {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2.5 py-2 odd:bg-card-soft/50">
      <PalChip id={a} gender={ga} onClick={() => onPick(a)} />
      <span className="text-xs font-bold text-ink-muted">+</span>
      <PalChip id={b} gender={gb} onClick={() => onPick(b)} />
      <span className="text-xs font-bold text-pal">=</span>
      <PalChip id={c} onClick={() => onPick(c)} />
    </li>
  );
}

/** 分批顯示 + 「顯示更多」。 */
function usePaged<T>(rows: T[]): { shown: T[]; more: number; showMore: () => void } {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [rows]);
  return {
    shown: rows.slice(0, limit),
    more: Math.max(0, rows.length - limit),
    showMore: () => setLimit((n) => n + PAGE_SIZE * 4),
  };
}

function MoreButton({ more, onClick }: { more: number; onClick: () => void }): JSX.Element | null {
  if (more <= 0) return null;
  return (
    <div className="flex justify-center border-t border-line p-2.5">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full bg-card-soft px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
      >
        {t("顯示更多(還有 {n} 筆)", { n: more })}
      </button>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`rounded-cute bg-card p-3 shadow-cute ring-1 ring-line sm:p-4 ${className}`}>{children}</div>;
}

/** 玩家視角下拉:灰字占位「篩選玩家…」、可打字過濾;✕ 清除 = 不啟用。 */
function PerspSelect({
  players,
  value,
  onChange,
}: {
  players: { uid: string; name: string }[];
  value: "off" | "all" | string;
  onChange: (v: "off" | "all" | string) => void;
}): JSX.Element {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const label =
    value === "all" ? t("全服所有帕魯") : value === "any" ? t("全部帕魯種類") : players.find((p) => p.uid === value)?.name ?? "";
  const raw = q.trim().toLowerCase();
  const list = [
    // 「全部帕魯種類」:不管伺服器有沒有人擁有,以全部 299 種計 —— 大家都沒有也查得到
    { uid: "any", name: t("全部帕魯種類") },
    { uid: "all", name: t("全服所有帕魯") },
    ...players.filter((p) => !raw || p.name.toLowerCase().includes(raw)),
  ];
  const pick = (uid: string) => {
    onChange(uid);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={boxRef} className="relative">
      <div
        className="flex min-h-10 w-52 cursor-text items-center gap-1.5 rounded-xl bg-card-soft px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-pal"
        onClick={() => setOpen(true)}
      >
        {value !== "off" && !open && (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{label}</span>
        )}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={value === "off" || open ? t("篩選玩家…") : ""}
          className={`min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted sm:text-sm ${
            value !== "off" && !open ? "w-0" : "flex-1"
          }`}
        />
        {value !== "off" && (
          <button
            type="button"
            aria-label={t("不啟用")}
            title={t("不啟用")}
            onClick={(e) => {
              e.stopPropagation();
              pick("off");
            }}
            className="shrink-0 rounded-full px-1 text-ink-muted transition hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl bg-card shadow-cute ring-1 ring-line">
          {list.length === 1 && raw && <p className="px-3 py-2 text-sm text-ink-muted">{t("沒有符合的玩家")}</p>}
          {list.map((o) => (
            <button
              key={o.uid}
              type="button"
              onClick={() => pick(o.uid)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-card-soft ${
                o.uid === value ? "bg-pal/10 font-bold text-pal" : "text-ink"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.uid === value && <span className="shrink-0">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 金字塔(路徑模式)
// ---------------------------------------------------------------------------

/** 金字塔一層兩側各縮多少 %(依總層數調整;頂端保留 ≥70% 寬,名稱不被擠掉)。 */
function pyramidShrink(depth: number): number {
  return Math.min(5, 15 / Math.max(1, depth));
}

/** 路徑列裡的一格帕魯(A 與 B 共用,資訊完全對稱:頭像/名稱/屬性/擁有)。 */
function PalCell({
  id,
  meta,
  owned,
  onClick,
  active,
  title,
  hint,
  big,
}: {
  id: string;
  meta?: PalMeta;
  /** 玩家視角:true/false = 擁有/缺;undefined = 未啟用 */
  owned?: boolean;
  onClick?: () => void;
  /** 對應的選單開著 → 高亮 */
  active?: boolean;
  title?: string;
  /** 名稱旁的補充(例:▾ 可選數量) */
  hint?: ReactNode;
  /** 目標列用大字 */
  big?: boolean;
}): JSX.Element {
  const info = palInfo(id);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-xl px-1.5 py-1 text-left sm:gap-2.5 ${
        onClick ? "cursor-pointer transition hover:bg-pal/10" : ""
      } ${active ? "ring-2 ring-sun" : ""}`}
    >
      {info.iconUrl && (
        <img
          src={info.iconUrl}
          alt=""
          className={`size-9 shrink-0 rounded-full bg-card-soft ring-1 ring-line sm:size-10 ${owned === false ? "opacity-70 grayscale" : ""}`}
        />
      )}
      <span className={`min-w-14 flex-1 truncate font-semibold text-ink ${big ? "text-base sm:text-lg" : "text-sm sm:text-base"}`}>
        {info.zh || id}
      </span>
      {hint}
      <span className="hidden shrink-0 gap-0.5 sm:flex">
        {(meta?.el ?? []).map((e) => (
          <ElementDot key={e} el={e} size="md" />
        ))}
      </span>
      {owned !== undefined && (
        <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold text-white ${owned ? "bg-grass" : "bg-sun"}`}>
          {owned ? "✓" : t("缺")}
        </span>
      )}
    </Tag>
  );
}

function PyramidTier({
  id,
  gen,
  depth,
  role,
  meta,
  owned,
  onClick,
  active,
  partner,
}: {
  id: string;
  gen: number;
  depth: number;
  role: "start" | "mid" | "target";
  meta?: PalMeta;
  /** 玩家視角:true/false = 擁有/缺;undefined = 未啟用 */
  owned?: boolean;
  /** 中間代可點擊 → 開啟「替換這一代」面板 */
  onClick?: () => void;
  /** 替換面板正開著這一代 */
  active?: boolean;
  /** B 夥伴卡(內嵌在同一張列卡右端;A 與 B 分開點擊,兩格等寬) */
  partner?: ReactNode;
}): JSX.Element {
  const mix = 4 + Math.round((depth === 0 ? 1 : gen / depth) * 12);
  const badge = role === "target" ? `🎯 ${t("目標")}` : role === "start" ? `🏁 ${t("起點")}` : t("第 {n} 代", { n: gen });
  return (
    <div
      className={`flex h-full w-full items-center gap-1.5 rounded-cute px-2.5 py-2 shadow-cute ring-1 sm:gap-2.5 sm:px-3.5 sm:py-2.5 ${
        role === "target" ? "ring-2 ring-pal" : "ring-line"
      }`}
      style={{ background: `color-mix(in oklab, var(--color-pal) ${mix}%, var(--color-card))` }}
    >
      {/* A:該代帕魯(中間代可點擊替換);與 B 各佔一半 */}
      <PalCell
        id={id}
        meta={meta}
        owned={owned}
        onClick={onClick}
        active={active}
        title={onClick ? t("點擊替換這一代") : undefined}
        big={role === "target"}
      />
      {/* B:夥伴(同一張卡片內,獨立點擊;顯示資訊與 A 相同) */}
      {partner && (
        <>
          <span className="shrink-0 text-lg font-bold text-ink-muted sm:text-xl">+</span>
          {partner}
        </>
      )}
      {/* 世代徽章放整列最右:A + B 合起來才是這一代的配種 */}
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 sm:px-2.5 sm:py-1 sm:text-xs ${
          role === "mid" ? "bg-card-soft text-ink-muted ring-line" : "bg-pal/15 text-pal ring-pal/40"
        }`}
      >
        {badge}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 詞條/主動技能篩選:用自有帕魯排列組合解「把詞條帶到目標身上」的最佳路線
// ---------------------------------------------------------------------------

/** 節點目前帶到的目標詞條(親代看實際個體,配種結果看繼承遮罩)。 */
function nodeTraits(node: BreedingNode, desired: string[]): string[] {
  if (node.source) return node.source.passives.filter((p) => desired.includes(p));
  return desired.filter((_, i) => (node.passiveMask & (1 << i)) !== 0);
}

/** 親代來源說明:誰的帕魯/需捕捉/第 n 代配種結果 + 帶到哪些詞條。 */
function ParentTraitLine({ node, desired }: { node: BreedingNode; desired: string[] }) {
  const traits = nodeTraits(node, desired);
  const label = node.requiredCapture
    ? `⚠ ${t("需捕捉")}`
    : node.source
      ? t("{name} 的帕魯", { name: node.source.ownerName || "?" })
      : t("第 {n} 代配種結果", { n: node.generation });
  return (
    <span className="flex min-w-0 flex-1 basis-0 flex-wrap items-center gap-1">
      <span className="shrink-0 text-[11px] text-ink-muted">
        {palInfo(node.species).zh || node.species}({label}):
      </span>
      {traits.length ? (
        traits.map((p) => (
          <span key={p} className="max-w-full truncate rounded bg-pal/10 px-1.5 py-0.5 text-[10px] font-bold text-pal">
            {p}
          </span>
        ))
      ) : (
        <span className="text-[11px] text-ink-muted">—</span>
      )}
    </span>
  );
}

/** 起點約束用的虛擬詞條:NUL 開頭,絕不會撞到真實詞條/技能名稱。 */
const TRAIT_FROM_MARKER = "\u0000起點";

/** 個體在 desired 上的貢獻遮罩。 */
function traitMaskOf(passives: string[], desired: string[]): number {
  let m = 0;
  for (let i = 0; i < desired.length; i++) if (passives.includes(desired[i])) m |= 1 << i;
  return m;
}

/** 詞條解算結果:與最短路徑相同的梯度顯示 —— 目標在頂,往下每列 A + B 一次配種,
 *  父母各帶部分詞條(1:3、2:2 皆可),子代繼承聯集。
 *  每格都可點:葉端親代可切換成其他帶同樣詞條的自有個體(沒得換會說明);
 *  中間代是配種結果,詞條靠遺傳,不需要玩家已擁有。 */
function TraitSolutionView({
  solution,
  desired,
  maskDesired,
  fromName,
  metaOf,
  owned,
  onTargetClick,
  targetActive,
  onPickSpecies,
  speciesIdOf,
}: {
  solution: BreedingSolution;
  desired: string[];
  /** 解算實際用的需求(可能多一個起點虛擬詞條)—— 只用於遮罩比對,不顯示。 */
  maskDesired: string[];
  /** 有套用起點約束時的起點名稱(解不出來時提示可清除起點)。 */
  fromName?: string;
  metaOf: (id: string) => PalMeta | undefined;
  owned: SaveBreedingPal[];
  /** 點目標列 → 右側網格變成目標選擇器(與最短路徑的目標抽換一致)。 */
  onTargetClick?: () => void;
  targetActive?: boolean;
  /** 葉端面板選了「其他物種」→ 把牠設為起點並整路重算(代數會變)。 */
  onPickSpecies?: (speciesId: string) => void;
  /** 小寫物種鍵 → 配種表原大小寫 id。 */
  speciesIdOf?: (lower: string) => string | undefined;
}) {
  /** 開著哪一格的面板("{步驟}a"/"{步驟}b")。 */
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  /** 各格改選的個體(換路線/換詞條時重置)。 */
  const [overrides, setOverrides] = useState<Record<string, SaveBreedingPal>>({});
  useEffect(() => {
    setOpenSlot(null);
    setOverrides({});
  }, [solution]);

  const target = solution.target;
  if (!target) {
    return (
      <Card className="text-center">
        <p className="font-bold text-ink">{t("找不到能帶齊這些詞條的配種組合")}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {t("試著減少詞條數量、擴大玩家視角範圍,或先取得帶有這些詞條/技能的帕魯。")}
        </p>
        {fromName && (
          <p className="mt-1.5 text-sm text-ink-muted">
            ⚠ {t("目前限制路線必須從 {name} 起手 —— 清除起點或換一隻起點再試。", { name: fromName })}
          </p>
        )}
      </Card>
    );
  }
  // 使用者有指定起點時,把含起點(虛擬詞條標記)的子樹旋轉到 A 側,
  // 讓所選起點固定落在梯度最底列 —— 起點徽章與使用者的選擇對齊。
  const markerMemo = new Map<BreedingNode, boolean>();
  const containsMarker = (n: BreedingNode): boolean => {
    const hit = markerMemo.get(n);
    if (hit !== undefined) return hit;
    const v = n.source?.passives.includes(TRAIT_FROM_MARKER) || (n.parents?.some(containsMarker) ?? false);
    markerMemo.set(n, v);
    return v;
  };
  const rotMemo = new Map<BreedingNode, BreedingNode>();
  const rotate = (n: BreedingNode): BreedingNode => {
    const hit = rotMemo.get(n);
    if (hit) return hit;
    const c: BreedingNode = { ...n };
    rotMemo.set(n, c);
    if (n.parents) {
      let [a, b] = [rotate(n.parents[0]), rotate(n.parents[1])];
      if (!containsMarker(n.parents[0]) && containsMarker(n.parents[1])) [a, b] = [b, a];
      c.parents = [a, b];
    }
    return c;
  };
  const root = fromName ? rotate(target) : target;

  // 依依賴順序攤平配種步驟(葉在前、目標最後),再倒序 → 目標在最上;
  // 列的「代數」用顯示順序編號(底列=起點=第 0 層),分支樹也能維持金字塔形。
  const steps: BreedingNode[] = [];
  const seen = new Set<BreedingNode>();
  const visit = (n: BreedingNode) => {
    if (!n.parents || seen.has(n)) return;
    seen.add(n);
    visit(n.parents[0]);
    visit(n.parents[1]);
    steps.push(n);
  };
  visit(root);
  const d = steps.length;
  const shrink = pyramidShrink(d);
  const rowWidth = (gen: number) => ({ width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" as const });

  /** 套用使用者改選後的節點(只換 source 個體,物種/詞條貢獻不變)。 */
  const effective = (n: BreedingNode, slot: string): BreedingNode => {
    const o = overrides[slot];
    return o ? { ...n, source: o, requiredCapture: undefined } : n;
  };
  const ownedOf = (n: BreedingNode) => (n.requiredCapture ? false : n.source ? true : undefined);
  /** 這一格可切換的自有個體:同物種、性別相容、詞條涵蓋此格原本的貢獻。 */
  const candidatesFor = (n: BreedingNode): SaveBreedingPal[] => {
    const sp = n.species.toLowerCase();
    const genderNeed = n.gender === "m" ? "male" : n.gender === "f" ? "female" : null;
    return owned.filter(
      (c) =>
        normalizeSpecies(c.characterId) === sp &&
        (!genderNeed || c.gender === genderNeed) &&
        // 用 maskDesired(含起點虛擬詞條)比對,起點葉端的候選才不會被誤篩掉
        (traitMaskOf(c.passives, maskDesired) & n.passiveMask) === n.passiveMask,
    );
  };
  const isLeaf = (n: BreedingNode) => !n.parents;

  /** 面板:切換個體 / 遺傳說明 / 沒得換的說明。 */
  const slotPanel = (n: BreedingNode, slot: string, gen: number) => {
    if (openSlot !== slot) return null;
    const name = palInfo(n.species).zh || n.species;
    if (!isLeaf(n)) {
      return (
        <div className="mt-1.5 rounded-xl bg-card-soft/80 p-2.5 text-sm text-ink-muted ring-1 ring-pal/50" style={rowWidth(gen)}>
          🧬 {t("{name} 是第 {n} 代配種結果:由下面列的親代配出,所選詞條會自動遺傳,玩家不需要已擁有帶詞條的這隻帕魯。", { name, n: n.generation })}
        </div>
      );
    }
    const cur = effective(n, slot).source;
    const cands = candidatesFor(n);
    // 跨物種替代:其他物種、帶「此格目前貢獻的任一詞條」的自有帕魯(每物種取詞條最多的一隻)。
    // 選了 = 把該物種設為起點並整路重算 —— 例如原路線用疾旋鼬帶悠然泳姿,
    // 也可以改點勾魂魷,由解算器重新排出(可能更多代的)新路線。
    const contributes = nodeTraits(n, desired);
    const crossBySpecies = new Map<string, { pal: SaveBreedingPal; traits: string[] }>();
    if (onPickSpecies && speciesIdOf) {
      for (const c of owned) {
        const spLower = normalizeSpecies(c.characterId);
        if (spLower === n.species.toLowerCase()) continue;
        const traits = c.passives.filter((p) => desired.includes(p));
        if (!traits.length) continue;
        if (contributes.length && !traits.some((p) => contributes.includes(p))) continue;
        const prev = crossBySpecies.get(spLower);
        if (!prev || traits.length > prev.traits.length) crossBySpecies.set(spLower, { pal: c, traits });
      }
    }
    const cross = [...crossBySpecies.entries()]
      .map(([lower, v]) => ({ id: speciesIdOf?.(lower), ...v }))
      .filter((v): v is { id: string; pal: SaveBreedingPal; traits: string[] } => Boolean(v.id))
      .sort((a, b) => b.traits.length - a.traits.length)
      .slice(0, 24);
    return (
      <div className="mt-1.5 rounded-xl bg-card-soft/80 p-2 ring-1 ring-pal/50" style={rowWidth(gen)}>
        {cands.length === 0 ? (
          <p className="px-1 py-0.5 text-sm text-ink-muted">
            ⚠ {t("你沒有帶這些詞條的 {name} —— 需要先捕捉,或先用其他帕魯把詞條配上去。", { name })}
          </p>
        ) : cands.length === 1 && cur && cands[0].instanceId === cur.instanceId ? (
          <p className="px-1 py-0.5 text-sm text-ink-muted">{t("你沒有其他帶這些詞條的 {name} 可以切換。", { name })}</p>
        ) : (
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {cands.map((c) => {
              const active = cur ? c.instanceId === cur.instanceId : false;
              const traits = c.passives.filter((p) => desired.includes(p));
              return (
                <button
                  key={c.instanceId}
                  type="button"
                  onClick={() => {
                    setOverrides((prev) => ({ ...prev, [slot]: c }));
                    setOpenSlot(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                    active ? "bg-pal text-white ring-pal" : "bg-card text-ink ring-line hover:ring-pal"
                  }`}
                >
                  {c.nickname || palInfo(n.species).zh || n.species}
                  {c.gender === "male" ? "♂" : "♀"} · Lv.{c.level ?? "—"} · {c.ownerName}
                  {traits.length > 0 && (
                    <span className={active ? "text-white/80" : "text-pal"}>({traits.join("、")})</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {cross.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="mb-1.5 px-1 text-[11px] font-bold text-ink-muted">
              🔁 {t("換其他帶詞條的帕魯當起點(會重新計算路線與代數)")}
            </p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {cross.map(({ id, pal, traits }) => {
                const info = palInfo(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setOpenSlot(null);
                      onPickSpecies?.(id);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
                  >
                    {info.iconUrl && <img src={info.iconUrl} alt="" className="size-5 rounded-full bg-card-soft" />}
                    {info.zh || id}
                    <span className="text-pal">({traits.join("、")})</span>
                    <span className="text-ink-muted">{pal.ownerName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="overflow-hidden">
      {/* 目標列(只有結果,點擊可抽換目標)+ 將繼承的詞條 */}
      <div style={rowWidth(d)}>
        <PyramidTier
          id={target.species}
          gen={d}
          depth={d}
          role="target"
          meta={metaOf(target.species)}
          onClick={onTargetClick}
          active={targetActive}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 px-1" style={rowWidth(d)}>
        <span className="text-[11px] text-ink-muted">{t("目標將繼承")}:</span>
        {desired.map((p) => (
          <span key={p} className="rounded bg-pal/10 px-1.5 py-0.5 text-[10px] font-bold text-pal">
            {p}
          </span>
        ))}
      </div>
      {[...steps].reverse().map((s, i) => {
        // 顯示層編號:底列(最先要做的那次配種)= 0,往上遞增
        const gen = steps.length - 1 - i;
        const slotA = `${i}a`;
        const slotB = `${i}b`;
        const pa = effective(s.parents![0], slotA);
        const pb = effective(s.parents![1], slotB);
        // 起點徽章掛在「使用者所選起點實際加入」的那一列(靠虛擬詞條標記辨識);
        // 未指定起點時沿用底列 = 起點。
        const startRow = fromName
          ? s.parents!.some((x) => !x.parents && x.source?.passives.includes(TRAIT_FROM_MARKER))
          : gen === 0;
        return (
          <div key={i} className="mt-1.5">
            {/* 一列 = 這一次配種的 A + B(與最短路徑同樣式;兩格都可點) */}
            <div style={rowWidth(gen)}>
              <PyramidTier
                id={pa.species}
                gen={startRow ? 0 : Math.max(gen, 1)}
                depth={d}
                role={startRow ? "start" : "mid"}
                meta={metaOf(pa.species)}
                owned={ownedOf(pa)}
                active={openSlot === slotA}
                onClick={() => setOpenSlot(openSlot === slotA ? null : slotA)}
                partner={
                  <PalCell
                    id={pb.species}
                    meta={metaOf(pb.species)}
                    owned={ownedOf(pb)}
                    active={openSlot === slotB}
                    title={t("點擊切換這一格的帕魯")}
                    onClick={() => setOpenSlot(openSlot === slotB ? null : slotB)}
                  />
                }
              />
            </div>
            {slotPanel(pa, slotA, gen)}
            {slotPanel(pb, slotB, gen)}
            {/* 這一列雙親各帶哪些詞條(聯集會傳給子代) */}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1" style={rowWidth(gen)}>
              <ParentTraitLine node={pa} desired={desired} />
              <ParentTraitLine node={pb} desired={desired} />
            </div>
          </div>
        );
      })}
      {solution.requiredCaptures.length > 0 && (
        <p className="mt-2.5 text-xs text-ink-muted">
          ⚠ {t("需先捕捉:{list}", {
            list: solution.requiredCaptures
              .map((c) => `${palInfo(c.species).zh || c.species}${c.gender === "m" ? "♂" : c.gender === "f" ? "♀" : ""}`)
              .join("、"),
          })}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 變異(突變)配種:機率梯度
// ---------------------------------------------------------------------------

const pct = (v: number) => (v >= 0.1 ? `${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(2)}%`);

/** 一組變異父母:A + B ➜ 目標,附機率與期望顆數。 */
function MutationRow({
  pair,
  metaOf,
  ownedSet,
  rank,
  onPick,
  cake,
  farm,
  boosted,
}: {
  pair: MutationPair;
  metaOf: (id: string) => PalMeta | undefined;
  ownedSet: Set<string> | null;
  /** 顯示層級(0 = 機率最高那列),用來做金字塔縮排 */
  rank: number;
  onPick?: (id: string) => void;
  cake: CakeKind;
  farm: FarmKind;
  boosted: boolean;
}) {
  const has = (id: string) => (ownedSet ? ownedSet.has(id.toLowerCase()) : undefined);
  const eggs90 = eggsForConfidence(pair.perEgg, 0.9);
  const timeAvg = humanDuration(eggsToSeconds(pair.expectedEggs, cake, farm, boosted));
  return (
    <div className="mt-1.5" style={{ width: `calc(100% - ${Math.min(rank, 6) * 2.5}%)`, marginInline: "auto" }}>
      <div className="flex items-center gap-1.5 rounded-cute bg-card px-2.5 py-2 shadow-cute ring-1 ring-line sm:gap-2.5 sm:px-3.5">
        <PalCell id={pair.a.id} meta={metaOf(pair.a.id)} owned={has(pair.a.id)} onClick={onPick && (() => onPick(pair.a.id))} />
        <span className="shrink-0 text-lg font-bold text-ink-muted sm:text-xl">+</span>
        <PalCell id={pair.b.id} meta={metaOf(pair.b.id)} owned={has(pair.b.id)} onClick={onPick && (() => onPick(pair.b.id))} />
        <span className="shrink-0 rounded-full bg-berry/15 px-2 py-0.5 text-[11px] font-bold text-berry ring-1 ring-berry/40 sm:px-2.5 sm:py-1 sm:text-xs">
          <img src={MUTATION_ICON} alt="" className="inline-block size-3.5 align-[-2px]" /> {pct(pair.chance)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-ink-muted">
        <span>
          {t("每顆蛋")} <b className="text-ink">{pct(pair.perEgg)}</b>
        </span>
        <span>
          {t("平均")} <b className="text-ink">{Math.round(pair.expectedEggs)}</b> {t("顆蛋")}
          <b className="ml-1 text-pal">≈ {timeAvg}</b>
        </span>
        <span>
          {t("9 成把握")} <b className="text-ink">{Number.isFinite(eggs90) ? eggs90 : "—"}</b> {t("顆蛋")}
        </span>
        <span>{t("此組合突變共 {n} 種可能", { n: pair.outcomes })}</span>
      </div>
    </div>
  );
}

/** 變異配種主視圖:目標在頂,往下列出機率由高到低的父母組合。 */
function MutationView({
  index,
  target,
  metaOf,
  ownedSet,
  cake,
  onTargetClick,
  targetActive,
  onPick,
  ownedOnly,
  farm,
  boosted,
}: {
  index: MutationIndex;
  target: string;
  metaOf: (id: string) => PalMeta | undefined;
  ownedSet: Set<string> | null;
  cake: CakeKind;
  onTargetClick?: () => void;
  targetActive?: boolean;
  onPick?: (id: string) => void;
  /** 只列出「父母兩隻都擁有」的組合 */
  ownedOnly: boolean;
  farm: FarmKind;
  boosted: boolean;
}) {
  const info = index.byId.get(target);
  const pairs = useMemo(
    () => findMutationPairs(index, target, ownedOnly ? ownedSet : null, cake, 200),
    [index, target, ownedSet, cake, ownedOnly],
  );
  const bands = info ? requiredParentAvg(info.rank) : [];
  const [limit, setLimit] = useState(12);
  useEffect(() => setLimit(12), [target, cake, ownedOnly]);

  if (!info) return null;
  if (info.mut !== 1)
    return (
      <Card className="text-center">
        <p className="font-bold text-ink">{t("{name} 無法透過突變取得", { name: info.zh })}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {t("只有 143 隻帕魯列在突變名單內(只能自體繁殖的帕魯不會由突變產出)。請改選其他目標。")}
        </p>
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      {/* 目標列(可點擊抽換) */}
      <div style={{ width: "100%" }}>
        <PyramidTier
          id={target}
          gen={0}
          depth={0}
          role="target"
          meta={metaOf(target)}
          onClick={onTargetClick}
          active={targetActive}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-ink-muted">
        <span>
          {t("繁殖值")} <b className="text-ink">{info.rank}</b>
        </span>
        <span>
          {t("需要父母繁殖值平均落在")}{" "}
          <b className="text-ink">{bands.map((b) => `${Math.ceil(b.lo)}~${Math.floor(b.hi)}`).join(" 或 ")}</b>
        </span>
        <span>
          {t("突變觸發率")} <b className="text-ink">{pct(MUTATION_RATE[cake])}</b>
        </span>
      </div>

      {pairs.length === 0 ? (
        <p className="mt-3 rounded-cute bg-card-soft p-3 text-center text-sm text-ink-muted">
          {ownedOnly
            ? t("你擁有的帕魯裡沒有能突變出牠的組合 —— 取消「只看我有的」看全部可能。")
            : t("找不到能突變出牠的父母組合。")}
        </p>
      ) : (
        <>
          {pairs.slice(0, limit).map((p, i) => (
            <MutationRow
              key={`${p.a.id}-${p.b.id}`}
              pair={p}
              metaOf={metaOf}
              ownedSet={ownedSet}
              rank={i}
              onPick={onPick}
              cake={cake}
              farm={farm}
              boosted={boosted}
            />
          ))}
          {pairs.length > limit && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((n) => n + 20)}
                className="rounded-full bg-card-soft px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
              >
                {t("顯示更多(還有 {n} 筆)", { n: pairs.length - limit })}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 主元件
// ---------------------------------------------------------------------------

/** 變異帕魯官方圖示(取代 emoji)。以 / 開頭 → 模式卡當圖片渲染。 */
const MUTATION_ICON = "/mutation-pal.webp";

const MODES: { key: Mode; treeSub?: "tree" | "path"; icon: string; title: string; sub: string }[] = [
  { key: "chain", treeSub: "path", icon: "🪜", title: "最短路徑", sub: "起點到目標的最短配種路線" },
  { key: "pair", icon: "🥚", title: "配種計算", sub: "選兩隻父母,立刻看子代" },
  { key: "reverse", icon: "🔄", title: "反查組合", sub: "目標的全部父母組合" },
  { key: "chain", treeSub: "tree", icon: "🌳", title: "帕魯配種樹", sub: "樹狀展開 / 玩家視角" },
  { key: "mutation", icon: MUTATION_ICON, title: "變異配種", sub: "突變機率與期望蛋數" },
];

type SlotKey = "a" | "b" | "target" | "from" | "to";

/** 存檔物種代號 → 配種表命名空間(去 BOSS_ 等前綴與 _otomo 後綴,小寫)。 */
function normalizeSpecies(s: string): string {
  return s.replace(/^(BOSS_|PREDATOR_|SUMMON_|RAID_|GYM_)/i, "").replace(/_otomo$/i, "").toLowerCase();
}

export function BreedingQuery({ dataset }: { dataset?: Dataset | null }): JSX.Element {
  useI18n();
  const [data, setData] = useState<BreedingData | null>(null);
  const [metaMap, setMetaMap] = useState<Record<string, PalMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // paldex 名稱載好才渲染,避免先閃 id 再換名

  const [mode, setMode] = useState<Mode>("chain"); // 預設 = 第一張模式卡「🪜 最短路徑」
  // 配種計算:多組父母(第一組固定存在,只能清空;其餘可刪)
  const [pairs, setPairs] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [pairIdx, setPairIdx] = useState(0);
  const [revTarget, setRevTarget] = useState("");
  const [chainFrom, setChainFrom] = useState("");
  const [chainTo, setChainTo] = useState("");
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>("from"); // 預設路徑檢視,先選起點
  // 網格
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"deck" | "name" | "rarity">("deck");
  const [elFilter, setElFilter] = useState("");
  // 反查
  const [revTab, setRevTab] = useState<"asChild" | "asParent">("asChild");
  const [revQ, setRevQ] = useState("");
  // 帕魯配種樹:子檢視(樹狀/最短路徑)+ 玩家視角
  const [treeSub, setTreeSub] = useState<"tree" | "path">("path");
  /** 樹狀配種的目標(與最短路徑的 chainTo 分離,兩邊互不影響)。 */
  const [treeTarget, setTreeTarget] = useState("");
  const [persp, setPersp] = useState<"off" | "all" | string>("all");
  // 最短路徑檢視
  const [routeIdx, setRouteIdx] = useState(0);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());
  /** 開啟後起點自動鎖定「我擁有的帕魯中最短者」,目標變更會重新計算。 */
  const [autoStart, setAutoStart] = useState(false);
  /** 開啟自動起點前手動選的起點 —— 關閉開關時還原。 */
  const savedStartRef = useRef("");
  /** 使用者替換某一代後的自訂路線(null = 用演算法建議的路線)。 */
  const [custom, setCustom] = useState<ChainRoute | null>(null);
  /** 正在替換哪一代(1..distance-1;null = 未開啟替換面板)。 */
  const [openTier, setOpenTier] = useState<number | null>(null);
  const [tierQ, setTierQ] = useState("");
  /** 每一步選中的夥伴(B 卡);未選用預設(擁有優先第一個)。 */
  const [chosenPartners, setChosenPartners] = useState<Record<number, string>>({});
  /** B 夥伴選單的文字搜尋。 */
  const [partnerQ, setPartnerQ] = useState("");
  /** 詞條/主動技能篩選(合計 ≤4):選了之後改用自有帕魯排列組合解「帶詞條」路線。 */
  const [desired, setDesired] = useState<string[]>([]);
  // 變異配種:目標 / 蛋糕種類 / 只看擁有
  const [mutData, setMutData] = useState<MutationData | null>(null);
  const [mutTarget, setMutTarget] = useState("");
  const [cake, setCake] = useState<CakeKind>("deluxe");
  const [farm, setFarm] = useState<FarmKind>("normal");
  /** 據點內有滿星梁葉龍或寶寶保母(兩者不可疊加) */
  const [eggBoost, setEggBoost] = useState(false);
  const [mutOwnedOnly, setMutOwnedOnly] = useState(false);
  /** 開著哪個下拉:詞條 / 主動技能(兩個獨立下拉)。 */
  const [traitOpen, setTraitOpen] = useState<"passive" | "skill" | null>(null);
  const [traitQ, setTraitQ] = useState("");
  useEffect(() => {
    setRouteIdx(0);
    setOpenSteps(new Set());
    setCustom(null);
    setOpenTier(null);
    setTierQ("");
    setChosenPartners({});
  }, [chainFrom, chainTo]);

  useEffect(() => {
    let alive = true;
    Promise.all([loadBreeding(), loadMeta(), loadPaldex(), loadMutation()])
      .then(([d, m, , mut]) => {
        if (!alive) return;
        setData(d);
        setMetaMap(m);
        setMutData(mut);
        setReady(true);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const index = useMemo<BreedingTableIndex | null>(() => (data ? buildBreedingIndex(data) : null), [data]);

  /** 玩家視角:選定範圍(全服/單一玩家)擁有的物種集合(小寫,配種表命名空間)。
   *  「any(全部帕魯種類)」不做擁有標記(視同未啟用),但自動起點會涵蓋全部物種。 */
  const ownedSet = useMemo<Set<string> | null>(() => {
    if (!dataset || persp === "off" || persp === "any") return null;
    const set = new Set<string>();
    for (const { pal, owner } of dataset.allPals) {
      if (persp === "all" || owner.uid === persp) set.add(normalizeSpecies(pal.species));
    }
    return set;
  }, [dataset, persp]);

  /** 自動起點的來源池:any = 全部物種;否則 = 擁有的物種。 */
  const autoPool = useMemo<Set<string> | null>(() => {
    if (persp === "any" && index) return new Set([...index.speciesSet].map((s) => s.toLowerCase()));
    return ownedSet;
  }, [persp, index, ownedSet]);

  /** 詞條解算的自有帕魯範圍:選定玩家 = 該玩家;其他視角 = 全服。 */
  const inTraitPool = (uid: string) => persp === "all" || persp === "any" || persp === "off" || uid === persp;

  /** 詞條/主動技能選項(附範圍內持有隻數,多→少)。 */
  const traitOptions = useMemo(() => {
    if (!dataset) return null;
    const pc = new Map<string, number>();
    const sc = new Map<string, number>();
    for (const { pal, owner } of dataset.allPals) {
      if (!inTraitPool(owner.uid)) continue;
      for (const s of pal.passives) pc.set(s, (pc.get(s) ?? 0) + 1);
      for (const s of pal.mastered_skills) sc.set(s, (sc.get(s) ?? 0) + 1);
    }
    const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { passives: sorted(pc), skills: sorted(sc) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, persp]);


  /** 詞條解算的自有帕魯池(詞條+已學技能一起當可繼承詞條);獨立 memo 避免重複轉換。 */
  const ownedForTraits = useMemo<SaveBreedingPal[]>(() => {
    if (!dataset) return [];
    const owned: SaveBreedingPal[] = [];
    let i = 0;
    for (const { pal, owner } of dataset.allPals) {
      if (!inTraitPool(owner.uid)) continue;
      if (pal.gender !== "Male" && pal.gender !== "Female") continue;
      owned.push({
        instanceId: `${owner.uid}#${i++}`,
        // 統一正規化(去 BOSS_/PREDATOR_/SUMMON_ 等前綴):solveBreeding 只會剝 BOSS_,
        // 不先處理的話 PREDATOR_/SUMMON_ 變體對不上配方物種,等於整隻被解算器忽略。
        characterId: normalizeSpecies(pal.species),
        nickname: pal.nickname || undefined,
        level: pal.level,
        gender: pal.gender === "Male" ? "male" : "female",
        rank: pal.rank ?? 0,
        isLucky: pal.is_lucky,
        isBoss: pal.is_alpha,
        talentHp: pal.iv_hp,
        talentShot: pal.iv_attack,
        talentDefense: pal.iv_defense,
        passives: [...pal.passives, ...pal.mastered_skills],
        location: "palbox",
        ownerUid: owner.uid,
        ownerName: owner.name,
      });
    }
    return owned;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, persp]);

  /** 起點約束:有選起點時,把一個「虛擬詞條」記在該物種的自有帕魯身上並加入需求,
   *  逼解算器讓路線必含至少一隻起點物種的葉端 —— 起點選擇與運算結果從此一致。
   *  範圍內沒擁有該物種時無法約束(解算器本來就用不到牠),退回不限制。 */
  const traitSolveInputs = useMemo<{ owned: SaveBreedingPal[]; maskDesired: string[]; fromApplied: boolean }>(() => {
    if (!chainFrom || desired.length === 0)
      return { owned: ownedForTraits, maskDesired: desired, fromApplied: false };
    const fromLower = chainFrom.toLowerCase();
    let any = false;
    const owned = ownedForTraits.map((c) => {
      if (normalizeSpecies(c.characterId) !== fromLower) return c;
      any = true;
      return { ...c, passives: [...c.passives, TRAIT_FROM_MARKER] };
    });
    return any
      ? { owned, maskDesired: [...desired, TRAIT_FROM_MARKER], fromApplied: true }
      : { owned: ownedForTraits, maskDesired: desired, fromApplied: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedForTraits, chainFrom, desired]);

  /** 詞條模式解算:跑在 Web Worker(數秒的計算放主執行緒會凍住整個 UI),
   *  加 debounce 連續勾選等停手才送;seq 遞增,舊請求的結果直接丟棄,
   *  若上一輪還在算就整個 worker 終止重建(真正中止計算,不讓舊工作佔住)。 */
  const [traitSolution, setTraitSolution] = useState<BreedingSolution | null>(null);
  const [traitBusy, setTraitBusy] = useState(false);
  const traitWorkerRef = useRef<Worker | null>(null);
  const traitSeqRef = useRef(0);
  const traitInflightRef = useRef(false);
  useEffect(
    () => () => {
      traitWorkerRef.current?.terminate();
      traitWorkerRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!data || !chainTo || desired.length === 0 || !traitSolveInputs.owned.length) {
      traitSeqRef.current++; // 讓在途結果作廢
      setTraitSolution(null);
      setTraitBusy(false);
      return;
    }
    setTraitBusy(true);
    const id = window.setTimeout(() => {
      if (traitInflightRef.current && traitWorkerRef.current) {
        traitWorkerRef.current.terminate(); // 中止上一輪計算
        traitWorkerRef.current = null;
        traitInflightRef.current = false;
      }
      if (!traitWorkerRef.current) {
        traitWorkerRef.current = new Worker(new URL("./traitSolver.worker.ts", import.meta.url), { type: "module" });
        traitWorkerRef.current.addEventListener("message", (e: MessageEvent<{ seq: number; solution: BreedingSolution | null }>) => {
          traitInflightRef.current = false;
          if (e.data.seq !== traitSeqRef.current) return; // 過期結果
          setTraitSolution(e.data.solution);
          setTraitBusy(false);
        });
      }
      const seq = ++traitSeqRef.current;
      traitInflightRef.current = true;
      traitWorkerRef.current.postMessage({
        seq,
        data,
        owned: traitSolveInputs.owned,
        targetId: chainTo,
        desired: traitSolveInputs.maskDesired,
        maxGenerations: 4,
      });
    }, 400);
    return () => window.clearTimeout(id);
  }, [data, traitSolveInputs, chainTo, desired]);

  /** breeding.json 物種 id 保留原大小寫;插槽存原 id,顯示/查表都直接用。 */
  const species = useMemo(() => (index ? [...index.speciesSet] : []), [index]);
  const metaOf = (id: string) => metaMap[id];
  const nameOf = (id: string) => palInfo(id).zh || id;
  const byName = (x: string, y: string) => nameOf(x).localeCompare(nameOf(y));

  /** 網格排序 + 搜尋(四語/內部 id/圖鑑編號)+ 屬性過濾。 */
  /** 所有能配到目標的起點(id → 最短代數/組合數)—— 起點抽換與網格過濾共用。 */
  const startOptions = useMemo(() => {
    if (!index || !chainTo) return null;
    const map = new Map<string, { dist: number; combos: number }>();
    for (const S of index.speciesSet) {
      if (S === chainTo) continue;
      const sol = solveChain(index, S, chainTo, 1);
      if (sol) map.set(S, { dist: sol.distance, combos: sol.totalCombos });
    }
    return map;
  }, [index, chainTo]);

  /** 目標抽換候選:從目前起點出發能到達的所有帕魯(id → 最短代數/組合數)。 */
  const targetOptions = useMemo(() => {
    if (!index || !chainFrom) return null;
    const map = new Map<string, { dist: number; combos: number }>();
    for (const S of index.speciesSet) {
      if (S === chainFrom) continue;
      const sol = solveChain(index, chainFrom, S, 1);
      if (sol && sol.distance > 0) map.set(S, { dist: sol.distance, combos: sol.totalCombos });
    }
    return map;
  }, [index, chainFrom]);

  /** 詞條可行性:某詞條要能「配」到目標,至少要有一隻持有牠的自有帕魯
   *  (性別有效)且其物種在配種圖上真的能配到目標(startOptions)或就是目標本身。
   *  沒選目標時無從判斷,回 null = 不過濾。 */
  const feasibleTraits = useMemo<Set<string> | null>(() => {
    if (!dataset || !chainTo || !startOptions) return null;
    const reach = new Set([...startOptions.keys()].map((s) => s.toLowerCase()));
    reach.add(chainTo.toLowerCase());
    const ok = new Set<string>();
    for (const { pal, owner } of dataset.allPals) {
      if (!inTraitPool(owner.uid)) continue;
      if (pal.gender !== "Male" && pal.gender !== "Female") continue;
      if (!reach.has(normalizeSpecies(pal.species))) continue;
      for (const s of pal.passives) ok.add(s);
      for (const s of pal.mastered_skills) ok.add(s);
    }
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, chainTo, startOptions, persp]);

  /** 目前模式下,哪些帕魯已被選入插槽(卡片高亮用)。 */
  const selectedIds = useMemo(() => {
    if (mode === "pair") {
      const cur = pairs[Math.min(pairIdx, pairs.length - 1)];
      return new Set([cur?.a, cur?.b].filter(Boolean) as string[]);
    }
    if (mode === "reverse") return new Set([revTarget].filter(Boolean));
    if (mode === "chain")
      return new Set((treeSub === "tree" ? [treeTarget] : [chainFrom, chainTo]).filter(Boolean));
    if (mode === "mutation") return new Set([mutTarget].filter(Boolean));
    return new Set<string>();
  }, [mode, pairs, pairIdx, revTarget, chainFrom, chainTo, treeSub, treeTarget, mutTarget]);

  /** 變異索引(資料抓不到就停用該模式)。 */
  const mutIndex = useMemo<MutationIndex | null>(() => (mutData ? buildMutationIndex(mutData) : null), [mutData]);

  /** 點卡片 → 填入作用中插槽,並自動前進到下一個空插槽。 */
  const pickPal = (id: string) => {
    if (mode === "pair") {
      const idx = Math.min(pairIdx, pairs.length - 1);
      const cur = pairs[idx];
      const slot = activeSlot === "b" ? "b" : "a";
      setPairs((ps) => ps.map((p, i) => (i === idx ? { ...p, [slot]: id } : p)));
      if (slot === "a") setActiveSlot(cur.b ? null : "b");
      else setActiveSlot(cur.a ? null : "a");
    } else if (mode === "reverse") {
      setRevTarget(id);
      setActiveSlot(null);
    } else if (mode === "chain") {
      if (treeSub === "tree") {
        setTreeTarget(id);
        setActiveSlot(null);
        return;
      }
      // 開著替換面板時,點網格 = 直接套用到該處(目標/起點/中間代)
      if (openTier != null && chain) {
        if (openTier === chain.distance) {
          setChainTo(id);
          return;
        }
        if (openTier === 0) {
          setChainFrom(id);
          setAutoStart(false);
          return;
        }
        if (tierCandidates.some((c) => c.id === id)) applyTier(id);
        return; // 非法候選(理論上被 swapFilter 擋掉)忽略
      }
      const slot = activeSlot === "to" ? "to" : "from";
      if (slot === "from") {
        setChainFrom(id);
        setAutoStart(false); // 手動挑了起點 → 解除自動鎖定
        setActiveSlot(chainTo ? null : "to");
      } else {
        setChainTo(id);
        setActiveSlot(chainFrom ? null : "from");
      }
    } else if (mode === "mutation") {
      setMutTarget(id);
      setActiveSlot(null);
    }
  };

  const switchMode = (m: Mode, sub?: "tree" | "path") => {
    setMode(m);
    setQ("");
    setRevQ("");
    const s = sub ?? treeSub;
    if (sub) setTreeSub(sub);
    if (m === "pair") {
      const cur = pairs[Math.min(pairIdx, pairs.length - 1)];
      setActiveSlot(cur.a ? (cur.b ? null : "b") : "a");
    }
    else if (m === "reverse") setActiveSlot(revTarget ? null : "target");
    else if (m === "chain")
      setActiveSlot(s === "tree" ? (treeTarget ? null : "to") : chainFrom ? (chainTo ? null : "to") : "from");
    else if (m === "mutation") setActiveSlot(mutTarget ? null : "target");
    else setActiveSlot(null);
  };

  /** 跳到反查(其他模式點結果/帕魯時用)。 */
  const gotoReverse = (id: string) => {
    setRevTarget(id);
    setRevTab("asChild");
    setRevQ("");
    switchMode("reverse");
  };
  const gotoChain = (id: string, sub: "tree" | "path" = "tree") => {
    if (sub === "tree") setTreeTarget(id);
    else setChainTo(id);
    switchMode("chain", sub);
  };

  /** 自動起點(切換式):開啟時起點鎖定「來源池中到目標最短者」;
   *  來源池 = 擁有的帕魯,或「全部帕魯種類」時的全物種。 */
  useEffect(() => {
    if (!autoStart || !index || !autoPool || !chainTo) return;
    let best: { id: string; dist: number; combos: number } | null = null;
    for (const id of index.speciesSet) {
      if (!autoPool.has(id.toLowerCase()) || id === chainTo) continue;
      const sol = solveChain(index, id, chainTo, 1);
      if (!sol) continue;
      if (!best || sol.distance < best.dist || (sol.distance === best.dist && sol.totalCombos > best.combos)) {
        best = { id, dist: sol.distance, combos: sol.totalCombos };
      }
    }
    if (best) {
      setChainFrom(best.id);
      setActiveSlot(null);
    }
  }, [autoStart, index, autoPool, chainTo]);

  // ---- 各模式結果 ----
  /** 某一組父母的配種結果(空插槽 → 空陣列)。 */
  const outcomesFor = (p: { a: string; b: string }) => (index && p.a && p.b ? lookupPair(index, p.a, p.b) : []);
  const revMatcher = useMemo(() => {
    const raw = revQ.trim();
    if (!raw) return () => true;
    const lower = raw.toLowerCase();
    return (id: string) => id.toLowerCase().includes(lower) || Boolean(palInfo(id).zh?.includes(raw));
  }, [revQ, ready]);
  const revAsChild = useMemo(() => {
    if (!index || !revTarget) return [];
    return parentsOf(index, revTarget)
      .filter(([p1, , p2]) => revMatcher(p1) || revMatcher(p2))
      .sort(([x], [y]) => byName(x, y));
  }, [index, revTarget, revMatcher]);
  const revAsParent = useMemo(() => {
    if (!index || !revTarget) return [];
    return partnersOf(index, revTarget)
      .filter((r) => revMatcher(r.partner) || revMatcher(r.child))
      .sort((x, y) => byName(x.child, y.child) || byName(x.partner, y.partner));
  }, [index, revTarget, revMatcher]);
  const chain = useMemo(
    () => (index && chainFrom && chainTo ? solveChain(index, chainFrom, chainTo, 60) : null),
    [index, chainFrom, chainTo],
  );
  /** 作用中路線:使用者替換過某代 → 自訂路線;否則採目前選中的建議路線。 */
  const baseRoute = chain && chain.distance > 0 ? chain.routes[Math.min(routeIdx, chain.routes.length - 1)] : null;
  const activeRoute = custom ?? baseRoute;

  /** 第 openTier 代的替換候選。中間代:上一代能一步生出、剩餘代數不變;
   *  第 0 代(起點):所有能配到目標的帕魯(附各自最短代數 = 到目標的全部可能性)。 */
  const tierCandidates = useMemo(() => {
    if (!index || !chain || openTier == null || !activeRoute) return [];
    const has = (id: string) => ownedSet?.has(id.toLowerCase()) ?? false;
    if (openTier === chain.distance) {
      // 目標抽換:從目前起點出發可到達的所有帕魯(附各自最短代數)
      const rows = [...(targetOptions ?? new Map<string, { dist: number; combos: number }>())].map(([id, v]) => ({
        id,
        combos: v.combos,
        dist: v.dist,
      }));
      return rows.sort(
        (a, b) =>
          (ownedSet ? Number(has(b.id)) - Number(has(a.id)) : 0) || a.dist! - b.dist! || b.combos - a.combos || byName(a.id, b.id),
      );
    }
    if (openTier === 0) {
      const rows = [...(startOptions ?? new Map<string, { dist: number; combos: number }>())].map(([id, v]) => ({
        id,
        combos: v.combos,
        dist: v.dist,
      }));
      return rows.sort(
        (a, b) =>
          (ownedSet ? Number(has(b.id)) - Number(has(a.id)) : 0) || a.dist! - b.dist! || b.combos - a.combos || byName(a.id, b.id),
      );
    }
    const prev = activeRoute.species[openTier - 1];
    const rem = chain.distance - openTier;
    const rows: { id: string; combos: number; dist?: number }[] = [];
    for (const S of stepChildren(index, prev)) {
      if (rem > 0 && S === chainTo) continue;
      const sub = solveChain(index, S, chainTo, 1);
      if (!sub || sub.distance !== rem) continue;
      rows.push({ id: S, combos: sub.totalCombos * Math.max(1, edgeOptions(index, prev, S).length) });
    }
    return rows.sort(
      (a, b) =>
        (ownedSet ? Number(has(b.id)) - Number(has(a.id)) : 0) || b.combos - a.combos || byName(a.id, b.id),
    );
  }, [index, chain, openTier, activeRoute, chainTo, ownedSet, startOptions, targetOptions]);

  /** 套用替換:第 0 代 → 換起點;最頂代 → 換目標(整條重算);其餘保留之前世代,該代起重新求解。 */
  const applyTier = (S: string) => {
    if (!index || !chain || openTier == null || !activeRoute) return;
    if (openTier === chain.distance) {
      setChainTo(S); // 換目標 → chainTo 變更會觸發整組狀態重置與重算
      return;
    }
    if (openTier === 0) {
      setChainFrom(S);
      setAutoStart(false);
      setOpenTier(null);
      setTierQ("");
      setOpenSteps(new Set());
      setChosenPartners({});
      setCustom(null);
      return;
    }
    const sub = solveChain(index, S, chainTo, 1);
    if (!sub || !sub.routes[0]) return;
    const species = [...activeRoute.species.slice(0, openTier), ...sub.routes[0].species];
    const steps: ChainStep[] = [];
    let combos = 1;
    for (let i = 0; i + 1 < species.length; i++) {
      const partners = edgeOptions(index, species[i], species[i + 1]);
      steps.push({ from: species[i], to: species[i + 1], partners });
      combos *= Math.max(1, partners.length);
    }
    setCustom({ species, steps, combos });
    setOpenTier(null);
    setTierQ("");
    setOpenSteps(new Set());
    setChosenPartners({});
  };

  const pagedAsChild = usePaged(revAsChild);
  const pagedAsParent = usePaged(revAsParent);

  /** 詞條模式:擁有「帶任一所選詞條」帕魯的物種(配種表命名空間,原大小寫)。 */
  const traitCarrierSpecies = useMemo<Set<string> | null>(() => {
    if (!index || !dataset || desired.length === 0) return null;
    const carriers = new Set<string>();
    for (const { pal, owner } of dataset.allPals) {
      if (!inTraitPool(owner.uid)) continue;
      if (
        desired.some((d) => pal.passives.includes(d) || pal.mastered_skills.includes(d))
      )
        carriers.add(normalizeSpecies(pal.species));
    }
    return new Set([...index.speciesSet].filter((s) => carriers.has(s.toLowerCase())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, dataset, desired, persp]);

  /** 最短路徑的「網格即候選」過濾:開著哪個替換面板,右側網格就只顯示該處的合法選項。 */
  const swapFilter = useMemo<Set<string> | null>(() => {
    // 變異模式:網格只顯示「能由突變產出」的 143 隻
    if (mode === "mutation")
      return mutIndex ? new Set(mutIndex.eligible.map((p) => p.id)) : null;
    if (mode !== "chain" || treeSub !== "path") return null;
    // 詞條模式:挑起點時只顯示「擁有且帶所選詞條」的物種;
    // 目標不受限 —— 詞條靠多代遺傳帶過去,目標本身不必是玩家已擁有的帶詞條帕魯。
    if (desired.length > 0) {
      if (activeSlot === "from" && traitCarrierSpecies) return traitCarrierSpecies;
      return null;
    }
    if (openTier != null && chain) {
      if (openTier === chain.distance) return targetOptions ? new Set(targetOptions.keys()) : null;
      if (openTier === 0) return startOptions ? new Set(startOptions.keys()) : null;
      return new Set(tierCandidates.map((c) => c.id));
    }
    if (activeSlot === "from" && chainTo && startOptions) return new Set(startOptions.keys());
    return null;
  }, [mode, treeSub, openTier, chain, targetOptions, startOptions, tierCandidates, activeSlot, chainTo, desired, traitCarrierSpecies, mutIndex]);

  const gridRows = useMemo(() => {
    const raw = q.trim();
    const lower = raw.toLowerCase();
    let rows = species;
    if (swapFilter) rows = rows.filter((id) => swapFilter.has(id));
    if (elFilter) rows = rows.filter((id) => (metaMap[id]?.el ?? []).includes(elFilter));
    if (raw) {
      rows = rows.filter((id) => {
        if (id.toLowerCase().includes(lower)) return true;
        const m = metaMap[id];
        if (m && String(m.deck) === raw) return true;
        const info = palInfo(id);
        return Boolean(info.zh?.includes(raw)) || Boolean(info.zh?.toLowerCase().includes(lower));
      });
    }
    const cmp = (x: string, y: string) => {
      if (sortBy === "name") return byName(x, y);
      if (sortBy === "rarity") return (metaMap[y]?.r ?? 0) - (metaMap[x]?.r ?? 0) || byName(x, y);
      return (metaMap[x]?.deck || 9999) - (metaMap[y]?.deck || 9999) || byName(x, y);
    };
    return [...rows].sort(cmp);
  }, [species, q, elFilter, sortBy, metaMap, ready, swapFilter]);

  if (error)
    return (
      <div className="rounded-cute bg-berry/15 px-4 py-3 text-berry ring-1 ring-berry/30">
        {t("無法載入配種資料。")} {error}
      </div>
    );
  if (!index || !ready)
    return (
      <div className="rounded-cute bg-card px-6 py-16 text-center text-ink-muted shadow-cute ring-1 ring-line">
        {t("載入中…")}
      </div>
    );

  const { stats } = index;
  const complete = stats.pairCount === stats.expectedPairCount;

  return (
    <div className="space-y-3">
      {/* 模式切換:icon + 標題 + 副標(參考 palworld.gg 的功能卡) */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {MODES.map((m) => {
          // chain 有兩張卡(🪜/🌳),依 treeSub 區分選中狀態
          const act = mode === m.key && (m.key !== "chain" || treeSub === m.treeSub);
          return (
            <button
              key={m.key + (m.treeSub ?? "")}
              type="button"
              onClick={() => switchMode(m.key, m.treeSub)}
              className={`flex min-h-14 items-center gap-2.5 rounded-cute px-3 py-2 text-left ring-1 transition ${
                act ? "bg-pal/12 ring-2 ring-pal" : "bg-card ring-line hover:ring-pal"
              }`}
            >
              {m.icon.startsWith("/") ? (
                <img src={m.icon} alt="" className="size-6 shrink-0 object-contain" />
              ) : (
                <span className="text-xl">{m.icon}</span>
              )}
              <span className="min-w-0">
                <span className={`block truncate text-sm font-bold ${act ? "text-pal" : "text-ink"}`}>{t(m.title)}</span>
                <span className="block truncate text-[11px] text-ink-muted">{t(m.sub)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 桌機:主內容在左、選帕魯網格固定在「右」側欄;手機:網格垂直排在內容後面 */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,26rem)] lg:items-start">
      <div className="min-w-0 space-y-3 lg:order-1">

      {/* ---------------- 配種計算(正查):可新增多組父母 ---------------- */}
      {mode === "pair" && (
        <>
          {pairs.map((pair, idx) => {
            const outcomes = outcomesFor(pair);
            const isActive = idx === Math.min(pairIdx, pairs.length - 1);
            const activate = (slot: "a" | "b") => {
              setPairIdx(idx);
              setActiveSlot(slot);
            };
            return (
              <Card key={idx} className={`relative ${isActive ? "ring-2 ring-pal/60" : ""}`}>
                {pairs.length > 1 && (
                  <span className="absolute top-2 left-3 text-xs font-bold text-ink-muted">{t("第 {n} 組", { n: idx + 1 })}</span>
                )}
                {/* 第一組不能刪,✕ 只清空;其餘 ✕ 直接刪除整組 */}
                <button
                  type="button"
                  aria-label={idx === 0 ? t("清空這組") : t("刪除這組")}
                  title={idx === 0 ? t("清空這組") : t("刪除這組")}
                  onClick={() => {
                    if (idx === 0) {
                      setPairs((ps) => ps.map((p, i) => (i === 0 ? { a: "", b: "" } : p)));
                      setPairIdx(0);
                      setActiveSlot("a");
                    } else {
                      setPairs((ps) => ps.filter((_, i) => i !== idx));
                      setPairIdx((cur) => (cur === idx ? 0 : cur > idx ? cur - 1 : cur));
                    }
                  }}
                  className={`absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full text-xs font-bold shadow-sm transition hover:brightness-110 ${
                    idx === 0 ? "bg-card-soft text-ink-muted ring-1 ring-line hover:text-ink" : "bg-berry text-white"
                  }`}
                >
                  ✕
                </button>
                <div className="mx-auto flex max-w-2xl items-center justify-center gap-1.5 sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <SlotCard
                      role={t("父母一")}
                      id={pair.a}
                      meta={metaOf(pair.a)}
                      active={isActive && activeSlot === "a"}
                      onActivate={() => activate("a")}
                      onClear={() => {
                        setPairs((ps) => ps.map((p, i) => (i === idx ? { ...p, a: "" } : p)));
                        activate("a");
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-xl font-bold text-ink-muted sm:text-2xl">+</span>
                  <div className="min-w-0 flex-1">
                    <SlotCard
                      role={t("父母二")}
                      id={pair.b}
                      meta={metaOf(pair.b)}
                      active={isActive && activeSlot === "b"}
                      onActivate={() => activate("b")}
                      onClear={() => {
                        setPairs((ps) => ps.map((p, i) => (i === idx ? { ...p, b: "" } : p)));
                        activate("b");
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-xl font-bold text-pal sm:text-2xl">=</span>
                  <div className="min-w-0 flex-1">
                    {outcomes.length === 1 ? (
                      <SlotCard role={t("結果")} id={outcomes[0].child} meta={metaOf(outcomes[0].child)} active={false} accent />
                    ) : outcomes.length > 1 ? (
                      <div className="flex h-32 w-full flex-col items-stretch justify-center gap-1 rounded-cute border-2 border-sun bg-card px-2">
                        {outcomes.map((o, i) => (
                          <span key={i} className="flex min-w-0 items-center gap-1.5">
                            <img src={palInfo(o.child).iconUrl} alt="" className="size-8 shrink-0 rounded-full bg-card-soft ring-1 ring-line" />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-ink">{nameOf(o.child)}</span>
                              <span className="block text-[10px] text-ink-muted">
                                {nameOf(pair.a)}{o.genderA === "f" ? "♀" : "♂"} × {nameOf(pair.b)}{o.genderB === "f" ? "♀" : "♂"}
                              </span>
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <SlotCard role={t("結果")} id="" active={false} accent />
                    )}
                  </div>
                </div>
                {outcomes.length > 1 && (
                  <p className="mt-2 text-center text-xs text-ink-muted">{t("這組父母會依性別生出不同子代,兩種結果都列在上面。")}</p>
                )}
                {outcomes.length === 1 && (
                  <div className="mt-2.5 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => gotoReverse(outcomes[0].child)}
                      className="rounded-full bg-card-soft px-3.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
                    >
                      🔄 {t("反查 {name}", { name: nameOf(outcomes[0].child) })}
                    </button>
                    <button
                      type="button"
                      onClick={() => gotoChain(outcomes[0].child, "tree")}
                      className="rounded-full bg-card-soft px-3.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
                    >
                      🌳 {t("配種樹")}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
          {/* 新增一組:虛線卡片按鈕 */}
          <button
            type="button"
            onClick={() => {
              setPairs((ps) => [...ps, { a: "", b: "" }]);
              setPairIdx(pairs.length);
              setActiveSlot("a");
            }}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-cute border-2 border-dashed border-line bg-card/60 text-sm font-bold text-ink-muted transition hover:border-pal hover:text-pal"
          >
            ➕ {t("新增一組父母")}
          </button>
        </>
      )}

      {/* ---------------- 反查組合 ---------------- */}
      {mode === "reverse" && (
        <div className="space-y-3">
          <div className="space-y-3">
            <Card>
              <div className="mx-auto max-w-[240px]">
                <SlotCard
                  role={t("目標帕魯")}
                  id={revTarget}
                  meta={metaOf(revTarget)}
                  active={activeSlot === "target"}
                  onActivate={() => setActiveSlot("target")}
                  onClear={() => {
                    setRevTarget("");
                    setActiveSlot("target");
                  }}
                />
              </div>
              {revTarget && (
                <div className="mt-2.5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => gotoChain(revTarget, "tree")}
                    className="rounded-full bg-card-soft px-3.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
                  >
                    🌳 {t("怎麼配到牠?看帕魯配種樹")}
                  </button>
                </div>
              )}
            </Card>

            {revTarget && (
              <div className="overflow-hidden rounded-cute bg-card shadow-cute ring-1 ring-line">
                {/* 作為子代 / 作為父母(palworld.gg 的雙頁籤) */}
                <div className="flex border-b border-line">
                  {(
                    [
                      ["asChild", t("作為子代({n})", { n: revAsChild.length })],
                      ["asParent", t("作為父母({n})", { n: revAsParent.length })],
                    ] as ["asChild" | "asParent", string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setRevTab(k)}
                      className={`min-h-11 flex-1 px-3 text-sm font-semibold transition ${
                        revTab === k ? "border-b-2 border-pal bg-pal/8 text-pal" : "text-ink-muted hover:bg-card-soft"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="border-b border-line bg-card-soft/60 p-2">
                  <input
                    value={revQ}
                    onChange={(e) => setRevQ(e.target.value)}
                    placeholder={t("篩選組合…")}
                    className="w-full rounded-lg bg-card px-3 py-2 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal sm:text-sm"
                  />
                </div>
                {revTab === "asChild" ? (
                  revAsChild.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-ink-muted">
                      {revQ ? t("沒有符合的組合") : t("配種表中沒有能生出牠的組合。")}
                    </p>
                  ) : (
                    <>
                      <ul>
                        {pagedAsChild.shown.map(([p1, g1, p2, g2], i) => (
                          <ComboRow key={`${p1}-${p2}-${i}`} a={p1} ga={g1} b={p2} gb={g2} c={revTarget} onPick={gotoReverse} />
                        ))}
                      </ul>
                      <MoreButton more={pagedAsChild.more} onClick={pagedAsChild.showMore} />
                    </>
                  )
                ) : revAsParent.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-ink-muted">{t("沒有符合的組合")}</p>
                ) : (
                  <>
                    <ul>
                      {pagedAsParent.shown.map((row, i) => (
                        <ComboRow
                          key={`${row.partner}-${i}`}
                          a={revTarget}
                          ga={row.genderA}
                          b={row.partner}
                          gb={row.genderB}
                          c={row.child}
                          onPick={gotoReverse}
                        />
                      ))}
                    </ul>
                    <MoreButton more={pagedAsParent.more} onClick={pagedAsParent.showMore} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 變異配種 ---------------- */}
      {mode === "mutation" && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {dataset && <PerspSelect players={dataset.players} value={persp} onChange={setPersp} />}
              {/* 蛋糕:官方 1.0 更新說明的突變率 */}
              <div className="flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
                {(Object.keys(CAKES) as CakeKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={t(CAKES[k].note)}
                    onClick={() => setCake(k)}
                    className={`min-h-9 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition sm:text-sm ${
                      cake === k ? "bg-pal text-white" : "text-ink hover:bg-card"
                    }`}
                  >
                    {t(CAKES[k].label)} {Math.round(CAKES[k].rate * 100)}%
                  </button>
                ))}
              </div>
              {/* 產蛋設施:把期望顆數換算成實際時間 */}
              <div className="flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
                {(Object.keys(FARMS) as FarmKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFarm(k)}
                    className={`min-h-9 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition sm:text-sm ${
                      farm === k ? "bg-pal text-white" : "text-ink hover:bg-card"
                    }`}
                  >
                    {t(FARMS[k].label)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-sm text-ink" title={t("兩者效果不可疊加,取高者")}>
                <input type="checkbox" checked={eggBoost} onChange={(e) => setEggBoost(e.target.checked)} />
                {t("梁葉龍/寶寶保母")}
              </label>
              {ownedSet && (
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={mutOwnedOnly} onChange={(e) => setMutOwnedOnly(e.target.checked)} />
                  {t("只看我有的父母")}
                </label>
              )}
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {t("突變不走直系配方:父母的繁殖值決定一段區間,區間內的可突變帕魯都有機會生出。以下機率為估算(依 paldb 實測校正)。")}
            </p>
            {/* 玩家真正在意的:突變到底拿到什麼 */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[11px]">
              <span className="font-bold text-ink-muted">🎁 {t("突變固定帶")}:</span>
              {MUTATION_PERKS.map((p) => (
                <span key={p} className="rounded bg-grass/12 px-1.5 py-0.5 font-semibold text-grass">
                  {t(p)}
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-bold text-ink-muted">🌈 {t("突變專屬彩虹詞條")}:</span>
              {MUTATION_PASSIVES.map((p) => (
                <span key={p} className="rounded bg-berry/12 px-1.5 py-0.5 font-semibold text-berry">
                  {p}
                </span>
              ))}
              <span className="text-ink-muted">{t("(也可用耗材植入體在手術台取得)")}</span>
            </div>
          </Card>

          {!mutIndex ? (
            <Card className="text-center text-sm text-ink-muted">{t("變異資料載入失敗。")}</Card>
          ) : mutTarget ? (
            <MutationView
              index={mutIndex}
              target={mutTarget}
              metaOf={metaOf}
              ownedSet={ownedSet}
              cake={cake}
              ownedOnly={mutOwnedOnly}
              farm={farm}
              boosted={eggBoost}
              onTargetClick={() => setActiveSlot(activeSlot === "target" ? null : "target")}
              targetActive={activeSlot === "target"}
              onPick={(id) => gotoChain(id, "path")}
            />
          ) : (
            <Card className="flex min-h-85 flex-col items-center justify-center py-10 text-center">
              <img src={MUTATION_ICON} alt="" className="size-12 object-contain" />
              <p className="mt-2 font-bold text-ink">{t("點選帕魯,看牠的突變機率")}</p>
              <p className="mt-1 max-w-md text-sm text-ink-muted">
                {t("右側清單只顯示 143 隻「可由突變產出」的帕魯。選一隻就會列出能突變出牠的父母組合、每顆蛋的機率與平均要孵幾顆。")}
              </p>
            </Card>
          )}
        </>
      )}

      {/* ---------------- 帕魯配種樹 ---------------- */}
      {mode === "chain" && (
        <>
          {/* 玩家視角 + 詞條/主動技能兩個下拉(🪜/🌳 已提升為上層模式卡) */}
          {dataset && (
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <PerspSelect players={dataset.players} value={persp} onChange={setPersp} />
                {treeSub === "path" && traitOptions && (
                  <>
                    {(
                      [
                        ["passive", "🏷️", t("詞條")],
                        ["skill", "✨", t("主動技能")],
                      ] as ["passive" | "skill", string, string][]
                    ).map(([key, icon, label]) => {
                      const selectedHere = desired.filter((s) =>
                        (key === "passive" ? traitOptions.passives : traitOptions.skills).some(([n]) => n === s),
                      ).length;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setTraitOpen(traitOpen === key ? null : key);
                            setTraitQ("");
                          }}
                          className={`min-h-10 rounded-full px-3.5 text-sm font-semibold ring-1 transition ${
                            selectedHere > 0 || traitOpen === key
                              ? "bg-pal text-white ring-pal"
                              : "bg-card-soft text-ink ring-line hover:ring-pal"
                          }`}
                        >
                          {icon} {label}
                          {selectedHere > 0 ? ` (${selectedHere})` : ""} {traitOpen === key ? "▲" : "▼"}
                        </button>
                      );
                    })}
                    {desired.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDesired(desired.filter((x) => x !== p))}
                        title={t("移除")}
                        className="flex items-center gap-1 rounded-full bg-pal/12 px-3 py-1.5 text-sm font-semibold text-pal ring-1 ring-pal/40 hover:bg-pal hover:text-white"
                      >
                        {p} <span className="leading-none">✕</span>
                      </button>
                    ))}
                    {desired.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDesired([])}
                        className="text-xs text-ink-muted underline hover:text-ink"
                      >
                        {t("全部清除")}
                      </button>
                    )}
                  </>
                )}
                {ownedSet && (
                  <span className="ml-auto rounded-full bg-grass/15 px-2.5 py-1 text-xs font-semibold text-grass ring-1 ring-grass/40">
                    {t("已擁有 {n}/{total} 種", {
                      n: species.filter((s) => ownedSet.has(s.toLowerCase())).length,
                      total: species.length,
                    })}
                  </span>
                )}
              </div>
              {/* 下拉內容(詞條或主動技能其中之一) */}
              {treeSub === "path" && traitOptions && traitOpen && (
                <div className="mt-2.5 rounded-cute bg-card-soft p-2.5 ring-1 ring-line">
                  <input
                    value={traitQ}
                    onChange={(e) => setTraitQ(e.target.value)}
                    placeholder={t("搜尋詞條或技能…")}
                    className="mb-2 w-full rounded-lg bg-card px-3 py-2 text-sm text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
                  />
                  <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
                    {(traitOpen === "passive" ? traitOptions.passives : traitOptions.skills)
                      .filter(([s]) => !traitQ || s.toLowerCase().includes(traitQ.toLowerCase()))
                      .slice(0, 80)
                      .map(([s, n]) => {
                        const on = desired.includes(s);
                        const full = !on && desired.length >= 4;
                        // 排列組合可行性:帶此詞條的持有帕魯,其物種必須真能配到目標
                        const infeasible = !on && feasibleTraits != null && !feasibleTraits.has(s);
                        const off = full || infeasible;
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={off}
                            title={infeasible ? t("帶此詞條的持有帕魯都配不到目標,無法透過排列組合達成") : undefined}
                            onClick={() => setDesired(on ? desired.filter((x) => x !== s) : [...desired, s])}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                              on
                                ? "bg-pal text-white ring-pal"
                                : off
                                  ? "cursor-not-allowed bg-card text-ink-muted/50 ring-line line-through"
                                  : "bg-card text-ink ring-line hover:ring-pal"
                            }`}
                          >
                            {s} <span className={on ? "text-white/80" : "text-ink-muted"}>×{n}</span>
                          </button>
                        );
                      })}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {t("最多合計選 4 個;父母各帶部分詞條也可以(1:3、2:2),子代會繼承雙親詞條的聯集。")}
                  </p>
                </div>
              )}
            </Card>
          )}

          {/* ---- 樹狀配種:點帕魯清單直接長樹(目標與最短路徑分離) ---- */}
          {treeSub === "tree" &&
            (treeTarget ? (
              <BreedingTreeView
                index={index}
                target={treeTarget}
                owned={ownedSet}
                elementsOf={(id) => metaOf(id)?.el ?? []}
                onReverse={gotoReverse}
              />
            ) : (
              <Card className="flex min-h-[340px] flex-col items-center justify-center py-10 text-center">
                <p className="text-3xl">🌳</p>
                <p className="mt-2 font-bold text-ink">{t("點選帕魯,立即展開配種樹")}</p>
                <p className="mt-1 max-w-md text-sm text-ink-muted">
                  {t("從帕魯清單點一隻當目標(放在樹頂 👑),點節點展開父母組合;之後點其他帕魯可隨時切換目標。")}
                </p>
              </Card>
            ))}

          {/* ---- 最短路徑:起點 → 目標 ---- */}
          {treeSub === "path" && (
          <Card>
            <div className="mx-auto flex max-w-xl items-center justify-center gap-1.5 sm:gap-3">
              <div className="min-w-0 flex-1">
                <SlotCard
                  role={t("起點(你擁有)")}
                  id={chainFrom}
                  meta={metaOf(chainFrom)}
                  active={activeSlot === "from"}
                  onActivate={() => setActiveSlot("from")}
                  onClear={() => {
                    setChainFrom("");
                    setAutoStart(false);
                    setActiveSlot("from");
                  }}
                />
              </div>
              <button
                type="button"
                title={t("交換起點與目標")}
                aria-label={t("交換起點與目標")}
                onClick={() => {
                  setChainFrom(chainTo);
                  setChainTo(chainFrom);
                }}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card-soft ring-1 ring-line transition hover:ring-pal"
              >
                🔁
              </button>
              <div className="min-w-0 flex-1">
                <SlotCard
                  role={t("目標帕魯")}
                  id={chainTo}
                  meta={metaOf(chainTo)}
                  active={activeSlot === "to"}
                  onActivate={() => setActiveSlot("to")}
                  onClear={() => {
                    setChainTo("");
                    setActiveSlot("to");
                  }}
                />
              </div>
            </div>
            {autoPool && chainTo && (
              <div className="mt-2.5 flex justify-center">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoStart}
                  onClick={() => {
                    if (!autoStart) {
                      savedStartRef.current = chainFrom; // 記住手動選的起點
                      setAutoStart(true);
                    } else {
                      setAutoStart(false);
                      setChainFrom(savedStartRef.current); // 關閉 → 還原原本選擇
                    }
                  }}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ring-1 transition ${
                    autoStart ? "bg-pal text-white ring-pal" : "bg-pal/12 text-pal ring-pal/40 hover:bg-pal/20"
                  }`}
                >
                  ⚡ {persp === "any" ? t("自動找最短起點(全部帕魯種類)") : t("從我擁有的帕魯自動找最短起點")}
                  <span
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${autoStart ? "bg-white/35" : "bg-ink-muted/30"}`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all ${autoStart ? "left-4.5" : "left-0.5"}`}
                    />
                  </span>
                </button>
              </div>
            )}
          </Card>
          )}

          {treeSub === "path" && desired.length > 0 && chainTo && traitBusy && (
            <Card className="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-pal border-t-transparent" />
              {t("計算帶詞條路線中…")}
            </Card>
          )}
          {treeSub === "path" && desired.length > 0 && chainTo && !traitBusy && traitSolution && (
            <TraitSolutionView
              solution={traitSolution}
              desired={desired}
              maskDesired={traitSolveInputs.maskDesired}
              fromName={traitSolveInputs.fromApplied ? nameOf(chainFrom) : undefined}
              metaOf={metaOf}
              owned={traitSolveInputs.owned}
              onTargetClick={() => setActiveSlot(activeSlot === "to" ? null : "to")}
              targetActive={activeSlot === "to"}
              onPickSpecies={(sp) => {
                setChainFrom(sp);
                setAutoStart(false);
              }}
              speciesIdOf={(lower) => (index ? [...index.speciesSet].find((s) => s.toLowerCase() === lower) : undefined)}
            />
          )}
          {treeSub === "path" && desired.length > 0 && !chainTo && (
            <Card className="text-center text-sm text-ink-muted">{t("先選一隻目標帕魯,再看帶詞條路線。")}</Card>
          )}

          {treeSub === "path" && !desired.length && chainFrom && chainTo && !chain && (
            <Card className="text-center">
              {isSelfOnlyChild(index, chainTo) ? (
                <>
                  <p className="font-bold text-ink">{t("{name} 無法透過其他物種配種取得", { name: nameOf(chainTo) })}</p>
                  <p className="mt-1 text-sm text-ink-muted">{t("牠只能用兩隻同種配種繁殖 —— 請直接捕捉一對。")}</p>
                </>
              ) : (
                <>
                  <p className="font-bold text-ink">{t("從這個起點配不出目標")}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t("{name} 只能在特定家族內配種取得,請換一隻起點或直接捕捉。", { name: nameOf(chainTo) })}
                  </p>
                </>
              )}
            </Card>
          )}
          {treeSub === "path" && !desired.length && chain && chain.distance === 0 && (
            <Card className="text-center">
              <p className="font-bold text-ink">{t("起點就是目標帕魯")}</p>
              <p className="mt-1 text-sm text-ink-muted">{t("直接用兩隻 {name} 配種即可繁殖更多。", { name: nameOf(chainTo) })}</p>
            </Card>
          )}
          {treeSub === "path" && !desired.length && chain && chain.distance > 0 && (
            <div className="space-y-3">
              {/* 極簡控制列:只在套用過自訂替換時顯示還原 */}
              {custom && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustom(null);
                      setOpenTier(null);
                      setOpenSteps(new Set());
                      setChosenPartners({});
                    }}
                    className="min-h-10 rounded-full bg-sun/15 px-4 text-sm font-semibold text-ink ring-1 ring-sun/50 transition hover:ring-sun"
                  >
                    ↩ {t("還原路線")}
                  </button>
                </div>
              )}
              {(() => {
                const route = activeRoute!;
                const d = chain.distance;
                const shrink = pyramidShrink(d);
                const has = (id: string) => ownedSet?.has(id.toLowerCase()) ?? false;
                /** 這一步排序後的夥伴(擁有優先)與目前選中的 B。 */
                const partnersOfStep = (g: number) =>
                  [...route.steps[g].partners].sort((x, y) => {
                    if (ownedSet) {
                      const diff = Number(has(y.partner)) - Number(has(x.partner));
                      if (diff !== 0) return diff;
                    }
                    return (palInfo(x.partner).zh || x.partner).localeCompare(palInfo(y.partner).zh || y.partner);
                  });
                const chosenOf = (g: number) => {
                  const list = partnersOfStep(g);
                  const pick = chosenPartners[g];
                  return list.find((p) => p.partner === pick) ?? list[0];
                };
                return (
                  <Card className="overflow-hidden">
                    {route.species
                      .map((sp, gen) => ({ sp, gen }))
                      .reverse()
                      .map(({ sp, gen }) => (
                        <div key={gen}>
                          {/* 一列卡片 = A + B(A 可換該代帕魯、B 可換夥伴);頂端目標列只有結果 */}
                          <div style={{ width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" }}>
                            <PyramidTier
                              id={sp}
                              gen={gen}
                              depth={d}
                              role={gen === d ? "target" : gen === 0 ? "start" : "mid"}
                              meta={metaOf(sp)}
                              owned={ownedSet ? ownedSet.has(sp.toLowerCase()) : undefined}
                              active={openTier === gen}
                              onClick={() => {
                                setOpenTier(openTier === gen ? null : gen);
                                setOpenSteps(new Set());
                                setTierQ("");
                              }}
                              partner={
                                gen < d
                                  ? (() => {
                                      const chosen = chosenOf(gen);
                                      const stepOptions = route.steps[gen].partners.length;
                                      return (
                                        <PalCell
                                          id={chosen.partner}
                                          meta={metaOf(chosen.partner)}
                                          owned={ownedSet ? has(chosen.partner) : undefined}
                                          active={openSteps.has(gen)}
                                          title={t("點擊更換夥伴")}
                                          onClick={() => {
                                            setOpenTier(null);
                                            setPartnerQ("");
                                            setOpenSteps((prev) => {
                                              const next = new Set<number>();
                                              if (!prev.has(gen)) next.add(gen);
                                              return next;
                                            });
                                          }}
                                          hint={
                                            stepOptions > 1 ? (
                                              <span className="shrink-0 text-[11px] font-semibold text-ink-muted">▾{stepOptions}</span>
                                            ) : undefined
                                          }
                                        />
                                      );
                                    })()
                                  : undefined
                              }
                            />
                          </div>

                          {/* 內嵌:B 夥伴選擇(點選即套用) */}
                          {gen < d && openSteps.has(gen) && (
                            <div
                              className="mt-1.5 rounded-xl bg-card-soft/80 p-2 ring-1 ring-pal/50"
                              style={{ width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" }}
                            >
                              {partnersOfStep(gen).length > 8 && (
                                <input
                                  value={partnerQ}
                                  onChange={(e) => setPartnerQ(e.target.value)}
                                  placeholder={t("搜尋夥伴…")}
                                  className="mb-1.5 w-full rounded-lg bg-card px-3 py-2 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal sm:text-sm"
                                />
                              )}
                              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                                {partnersOfStep(gen)
                                  .filter((p) => {
                                    const raw = partnerQ.trim();
                                    if (!raw) return true;
                                    return (
                                      p.partner.toLowerCase().includes(raw.toLowerCase()) ||
                                      Boolean(palInfo(p.partner).zh?.includes(raw))
                                    );
                                  })
                                  .map((p, i) => {
                                  const cur = p.partner === chosenOf(gen).partner;
                                  return (
                                    <button
                                      key={`${p.partner}-${i}`}
                                      type="button"
                                      onClick={() => {
                                        setChosenPartners((m) => ({ ...m, [gen]: p.partner }));
                                        setOpenSteps(new Set());
                                      }}
                                      className={`flex min-h-10 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold text-ink ring-1 transition hover:ring-pal ${
                                        cur ? "ring-2 ring-pal" : "ring-line"
                                      }`}
                                    >
                                      <img
                                        src={palInfo(p.partner).iconUrl}
                                        alt=""
                                        loading="lazy"
                                        className={`size-7 rounded-full bg-card-soft ring-1 ring-line ${ownedSet && !has(p.partner) ? "opacity-70 grayscale" : ""}`}
                                      />
                                      <span className="max-w-28 truncate">{nameOf(p.partner)}</span>
                                      {ownedSet &&
                                        (has(p.partner) ? (
                                          <span className="text-xs font-bold text-grass">✓</span>
                                        ) : (
                                          <span className="text-xs font-bold text-sun">{t("缺")}</span>
                                        ))}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 內嵌:A 世代替換(維持總代數,之後路線自動重算) */}
                          {openTier === gen && (
                            <div
                              className="mt-1.5 rounded-xl bg-card-soft/80 p-2 ring-1 ring-sun/50"
                              style={{ width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" }}
                            >
                              {gen === 0 && (
                                <p className="mb-1.5 px-1 text-xs font-semibold text-ink-muted">
                                  {t("更換起點:共 {n} 種帕魯能配到「{name}」", { n: tierCandidates.length, name: nameOf(chainTo) })}
                                </p>
                              )}
                              {gen === d && (
                                <p className="mb-1.5 px-1 text-xs font-semibold text-ink-muted">
                                  {t("更換目標:從「{name}」出發共 {n} 種帕魯可到達", { name: nameOf(chainFrom), n: tierCandidates.length })}
                                </p>
                              )}
                              {tierCandidates.length > 12 && (
                                <input
                                  value={tierQ}
                                  onChange={(e) => setTierQ(e.target.value)}
                                  placeholder={t("篩選帕魯…")}
                                  className="mb-1.5 w-full rounded-lg bg-card px-3 py-2 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal sm:text-sm"
                                />
                              )}
                              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                                {tierCandidates
                                  .filter(({ id }) => {
                                    const raw = tierQ.trim();
                                    if (!raw) return true;
                                    return id.toLowerCase().includes(raw.toLowerCase()) || Boolean(palInfo(id).zh?.includes(raw));
                                  })
                                  .map(({ id, combos, dist }) => {
                                    const current = id === route.species[gen];
                                    return (
                                      <button
                                        key={id}
                                        type="button"
                                        onClick={() => applyTier(id)}
                                        title={t("{n} 種組合", { n: combos.toLocaleString() })}
                                        className={`flex min-h-10 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold text-ink ring-1 transition hover:ring-pal ${
                                          current ? "ring-2 ring-pal" : "ring-line"
                                        }`}
                                      >
                                        {palInfo(id).iconUrl && (
                                          <img
                                            src={palInfo(id).iconUrl}
                                            alt=""
                                            loading="lazy"
                                            className={`size-7 rounded-full bg-card-soft ring-1 ring-line ${ownedSet && !has(id) ? "opacity-70 grayscale" : ""}`}
                                          />
                                        )}
                                        <span className="max-w-28 truncate">{nameOf(id)}</span>
                                        {dist != null && (
                                          <span className="shrink-0 rounded-full bg-pal/12 px-1.5 py-px text-[10px] font-bold text-pal">
                                            {t("{n} 代", { n: dist })}
                                          </span>
                                        )}
                                        {ownedSet &&
                                          (has(id) ? (
                                            <span className="text-xs font-bold text-grass">✓</span>
                                          ) : (
                                            <span className="text-xs font-bold text-sun">{t("缺")}</span>
                                          ))}
                                        {current && <span className="text-xs font-bold text-pal">{t("目前")}</span>}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          )}

                          {/* 世代之間的箭頭 */}
                          {gen > 0 && (
                            <div className="flex justify-center py-1 text-base leading-none text-pal" aria-hidden="true">
                              ▲
                            </div>
                          )}
                        </div>
                      ))}
                  </Card>
                );
              })()}

              <p className="text-center text-xs text-ink-muted">
                {t("由下往上讀:每一列 A + B 配種,孵蛋後生出上一列;點 A 換那一代的帕魯、點 B 換夥伴,之後的路線會自動重算。")}
              </p>
            </div>
          )}
        </>
      )}

      </div>

      {/* ---------------- 共用帕魯網格(點卡片填入插槽;桌機為右側欄) ---------------- */}
      {(
        <div className="min-w-0 lg:sticky lg:top-3 lg:order-2">
        <Card>
          <div className="mb-2.5 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("🔍 搜尋帕魯名稱 / 圖鑑編號…")}
                  className="w-full rounded-xl bg-card-soft px-4 py-2.5 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal sm:pr-16 sm:text-sm"
                />
                <span className="absolute top-1/2 right-3 hidden -translate-y-1/2 text-xs tabular-nums text-ink-muted sm:block">
                  {gridRows.length} / {species.length}
                </span>
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-xl bg-card-soft px-3 py-2.5 text-base text-ink ring-1 ring-line sm:text-sm"
              >
                <option value="deck">{t("圖鑑編號")}</option>
                <option value="name">{t("名稱")}</option>
                <option value="rarity">{t("稀有度")}</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setElFilter("")}
                className={`min-h-8 rounded-full px-2.5 text-xs font-semibold ring-1 transition ${
                  elFilter === "" ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink-muted ring-line hover:ring-pal"
                }`}
              >
                {t("全部")}
              </button>
              {Object.keys(EL_COLORS)
                .filter((e) => e !== "電")
                .map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setElFilter(elFilter === e ? "" : e)}
                    className={`rounded-full p-1 ring-2 transition ${elFilter === e ? "ring-pal" : "ring-transparent hover:ring-line"}`}
                    aria-label={e}
                  >
                    <ElementDot el={e} size="md" />
                  </button>
                ))}
              {mode === "chain" && treeSub === "path" && openTier != null && chain ? (
                <span className="ml-auto text-xs font-semibold text-sun">
                  {t("點卡片替換「{slot}」", {
                    slot:
                      openTier === chain.distance
                        ? t("目標")
                        : openTier === 0
                          ? t("起點")
                          : t("第 {n} 代", { n: openTier }),
                  })}
                </span>
              ) : activeSlot ? (
                <span className="ml-auto text-xs font-semibold text-pal">
                  {t("點卡片填入「{slot}」", {
                    slot:
                      activeSlot === "a"
                        ? t("父母一")
                        : activeSlot === "b"
                          ? t("父母二")
                          : activeSlot === "from"
                            ? t("起點(你擁有)")
                            : t("目標帕魯"),
                  })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid max-h-[52dvh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:max-h-[calc(100dvh-9rem)] lg:grid-cols-3">
            {gridRows.map((id) => (
              <PalCard key={id} id={id} meta={metaOf(id)} selected={selectedIds.has(id)} onClick={() => pickPal(id)} />
            ))}
          </div>
        </Card>
        </div>
      )}
      </div>

      <p className="text-center text-xs text-ink-muted">
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
            })}{" "}
        · {t("配方資料來自 Pal Calc {version}(MIT)", { version: data?.version ?? "" })}
      </p>
    </div>
  );
}
