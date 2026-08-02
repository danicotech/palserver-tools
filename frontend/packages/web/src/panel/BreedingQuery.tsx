// 「配種表」分頁:純靜態查表(breeding.json,palcalc MIT 資料),不依賴存檔資料集。
// UI 參考 palworld.gg / palbreed.com / op.gg 的配種工具重構:
//   插槽(A + B = C)+ 永遠可見的卡片網格 —— 點卡片填入作用中插槽,不用下拉選單。
// 四種模式:配種計算(正查)、反查組合(作為子代/作為父母)、路徑金字塔、稀有配方。
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, ReactNode } from "react";
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
import {
  buildCarrierReach,
  buildMutationReach,
  buildTraitGraph,
  solveHybrid,
  startCandidates,
  stepOptions,
  MUTATION_INHERIT,
  type HybridPath,
  type MaskReach,
  type MutationReach,
  type PathMode,
  type PathStrategy,
  type StartCandidate,
  type StepOption,
  type TraitGraph,
} from "../hybridPath";
import { MutationSettings } from "./MutationSettings";
import { loadPaldex, palInfo } from "./paldex";
import { BreedingTreeView, ElementDot, EL_COLORS } from "./BreedingTreeView";
import type { Dataset } from "./data";
import type { Pal, Player } from "./types";
import { PalTile } from "./PalTile";
import { t, useI18n } from "../i18n";

/** 一次顯示的列數;反查最多會有 1280 列,分批渲染避免一次塞爆 DOM。 */
const PAGE_SIZE = 40;

// ---------------------------------------------------------------------------
// 靜態資料載入
// ---------------------------------------------------------------------------

type Mode = "pair" | "reverse" | "chain";

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
  compact,
  onHover,
  sub,
  nameAfter,
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
  /** 精簡樣式:省略屬性點與擁有徽章(用在「= 結果」格,一列才塞得下) */
  compact?: boolean;
  /** 滑入/滑出:開關「誰有這隻」的浮動說明(傳 null = 關) */
  onHover?: (rect: DOMRect | null) => void;
  /** 名稱下方的小字 —— 這一格自己的註解(要帶哪些詞條、是誰的、累積到幾個) */
  sub?: ReactNode;
  /** 緊接在名稱右邊的東西(例:👥 看誰有這隻)。 */
  nameAfter?: ReactNode;
}): JSX.Element {
  const info = palInfo(id);
  // 外層一律用 div 而不是 button:nameAfter 裡面會放另一顆可點的東西,
  // button 裡不能再放 button(HTML 不合法,而且點內層會連外層一起觸發)。
  // 可點時補上 role/tabIndex/鍵盤操作,保留原本的無障礙行為。
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onClick();
            }
          : undefined
      }
      onClick={onClick}
      title={title}
      onMouseEnter={onHover ? (e) => onHover(e.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocus={onHover ? (e) => onHover(e.currentTarget.getBoundingClientRect()) : undefined}
      onBlur={onHover ? () => onHover(null) : undefined}
      className={`flex flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-left sm:gap-2.5 ${
        // 名稱旁多了 👥 之後,原本的 24 基準會把名字擠成「火…」。
        // 給一個「放得下三個字 + 👥」的下限,窄的時候讓整列換行(名字完整分兩行看),
        // 而不是硬擠在一行然後兩邊都被截掉。
        // basis-auto 而不是固定基準:讓格子依內容撐開,內容才不會溢出去
        // (👥 會被屬性圓標壓在上面);真的塞不下時外層 flex-wrap 會換行。
        nameAfter ? "min-w-44 basis-auto" : "min-w-24 basis-24"
      } ${
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
      <span className="flex min-w-14 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1">
          {/* 有 👥 時名稱不截斷:寧可讓整列換行,也不要出現「吹‥」這種看不懂的東西。
              帕魯名都很短(2-5 個字),不截斷不會爆版。 */}
          <span
            className={`font-semibold text-ink ${nameAfter ? "whitespace-nowrap" : "truncate"} ${
              big ? "text-base sm:text-lg" : "text-sm sm:text-base"
            }`}
          >
            {info.zh || id}
          </span>
          {nameAfter}
        </span>
        {sub && <span className="flex flex-wrap items-center gap-0.5 text-[10px] leading-tight">{sub}</span>}
      </span>
      {hint}
      {!compact && (
        <span className="hidden shrink-0 gap-0.5 sm:flex">
          {(meta?.el ?? []).map((e) => (
            <ElementDot key={e} el={e} size="md" />
          ))}
        </span>
      )}
      {!compact && owned !== undefined && (
        <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold text-white ${owned ? "bg-grass" : "bg-sun"}`}>
          {owned ? "✓" : t("缺")}
        </span>
      )}
    </div>
  );
}

/** 某物種的一隻自有個體(含主人)—— 持有者統計與明細都用它。 */
export interface OwnedPalRow {
  pal: Pal;
  owner: Player;
}

/** 「誰有這隻」面板:誰擁有這隻,以及(有詞條需求時)誰帶得動這一步要的詞條。
 *  原本做成滑過就浮出來的浮層,但它會蓋住下面的梯度 —— 改成點「👥 誰有」
 *  才展開,而且是接在該列下方,把內容往下推而不是遮住。 */
function OwnerPanel({
  id,
  need,
  desired,
  enabled,
  scopeOwner,
  details,
  chosen,
  onChoose,
  style,
  onClose,
}: {
  id: string;
  /** 這一步這隻必須帶進來的詞條 bitmask(0 = 不必帶,純瀏覽) */
  need: number;
  /** 目前選的詞條(空 = 沒開篩選) */
  desired: string[];
  /** 玩家視角有沒有開(關掉就不列持有者) */
  enabled: boolean;
  /** 視角鎖定在某位玩家時的名字;全服視角為 undefined —— 只影響「沒有人有」的措辭 */
  scopeOwner?: string;
  /** 同一物種、視角範圍內的全部個體 */
  details: OwnedPalRow[];
  /** 這一格目前指定的那一隻(有的話) */
  chosen?: OwnedPalRow;
  /** 選定某一隻 → 抽換這一格用的個體 */
  onChoose?: (row: OwnedPalRow) => void;
  style?: CSSProperties;
  onClose: () => void;
}): JSX.Element {
  useI18n();
  /** 點了哪位持有者 → 彈出他那幾隻 */
  const [who, setWho] = useState<string | null>(null);
  const info = palInfo(id.toLowerCase());
  const needNames = desired.filter((_, i) => need & (1 << i));
  const covers = (r: OwnedPalRow) =>
    needNames.every((x) => r.pal.passives.includes(x) || r.pal.mastered_skills.includes(x));
  /** 有詞條需求時,只列「真的帶得動」的個體 —— 列出配不上的人只會誤導。 */
  const usable = needNames.length > 0 ? details.filter(covers) : details;
  const byOwner = new Map<string, number>();
  for (const r of usable) byOwner.set(r.owner.name, (byOwner.get(r.owner.name) ?? 0) + 1);
  const owners = [...byOwner]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const total = usable.length;

  return (
    <div className="mt-1 rounded-xl bg-card-soft/80 p-2 text-[11px] ring-1 ring-pal/40" style={style}>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {info.iconUrl && <img src={info.iconUrl} alt="" className="size-6 shrink-0 rounded-full bg-card ring-1 ring-line" />}
        <span className="min-w-0 flex-1">
          <b className="text-ink">{info.zh || id}</b>
          {enabled && (
            <span className="ml-1 text-ink-muted">
              {owners.length
                ? scopeOwner
                  ? t("{total} 隻", { total })
                  : t("{n} 人共 {total} 隻", { n: owners.length, total })
                : needNames.length > 0
                  ? scopeOwner
                    ? t("{name} 沒有帶得動的這隻", { name: scopeOwner })
                    : t("沒有人有帶得動的這隻")
                  : scopeOwner
                    ? t("{name} 沒有這隻", { name: scopeOwner })
                    : t("全服沒有人有")}
            </span>
          )}
          {needNames.length > 0 && (
            <span className="ml-1 text-ink-muted">
              · {t("這一步要帶")}{" "}
              {needNames.map((x) => (
                <span key={x} className="ml-0.5 rounded bg-pal/12 px-1 py-0.5 font-bold text-pal">
                  {x}
                </span>
              ))}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("收合")}
          className="shrink-0 rounded-full px-1.5 text-ink-muted transition hover:text-ink"
        >
          ✕
        </button>
      </div>

      {chosen && (
        <p className="mb-1 text-ink-muted">
          {t("目前用")} <b className="text-ink">{chosen.owner.name}</b>
          {chosen.pal.nickname ? `「${chosen.pal.nickname}」` : ""} Lv{chosen.pal.level}
        </p>
      )}

      {enabled && owners.length > 0 && (
        <>
          <p className="mb-1 font-bold text-ink-muted">
            {needNames.length > 0 ? `🏷️ ${t("誰有帶得動的這隻(點名字挑一隻)")}` : `👥 ${t("持有者")}`}
          </p>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {owners.map((o) => (
              <button
                key={o.name}
                type="button"
                onClick={() => setWho(o.name)}
                title={t("查看 {name} 的這 {n} 隻", { name: o.name, n: o.n })}
                className={`rounded bg-card px-1.5 py-0.5 ring-1 transition hover:ring-pal ${
                  chosen?.owner.name === o.name ? "ring-grass" : "ring-line"
                }`}
              >
                <b className="text-ink">{o.name}</b>
                <span className="text-ink-muted">×{o.n}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {who && (
        <OwnerPalsModal
          title={t("{name} 的 {pal}", { name: who, pal: info.zh || id })}
          rows={usable.filter((r) => r.owner.name === who)}
          desired={desired}
          need={need}
          onChoose={
            onChoose &&
            ((row) => {
              onChoose(row);
              setWho(null);
            })
          }
          onClose={() => setWho(null)}
        />
      )}
    </div>
  );
}

/** 某位玩家的某物種全部個體 —— 點持有者才彈出。
 *  卡片直接用帕魯查詢的現成元件(PalTile),點一下就是選這一隻,
 *  頭像、屬性、星級、工作適性、詞條的呈現全站一致。 */
function OwnerPalsModal({
  title,
  rows,
  desired,
  need,
  onChoose,
  onClose,
}: {
  title: string;
  rows: OwnedPalRow[];
  desired: string[];
  /** 這一步需要的詞條 bitmask(>0 = 選取模式:點卡片就是挑這一隻) */
  need: number;
  /** 選取模式下點卡片要做什麼;沒給就只開詳情 */
  onChoose?: (row: OwnedPalRow) => void;
  onClose: () => void;
}): JSX.Element {
  useI18n();
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needNames = desired.filter((_, i) => need & (1 << i));
  const covers = (p: Pal) =>
    needNames.length > 0 && needNames.every((x) => p.passives.includes(x) || p.mastered_skills.includes(x));
  const sorted = [...rows].sort(
    (a, b) =>
      Number(covers(b.pal)) - Number(covers(a.pal)) ||
      b.pal.iv_hp + b.pal.iv_attack + b.pal.iv_defense - (a.pal.iv_hp + a.pal.iv_attack + a.pal.iv_defense) ||
      b.pal.level - a.pal.level,
  );
  const kw = q.trim().toLowerCase();
  const shown = kw
    ? sorted.filter(
        (r) =>
          (r.pal.nickname || "").toLowerCase().includes(kw) ||
          r.pal.passives.some((x) => x.toLowerCase().includes(kw)) ||
          r.pal.mastered_skills.some((x) => x.toLowerCase().includes(kw)),
      )
    : sorted;
  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-cute bg-card p-4 shadow-cute ring-1 ring-line"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {/* 標題列固定,清單自己捲 —— 幾十隻時才不會捲到找不到關閉鈕 */}
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-ink">{title}</b>
            <span className="shrink-0 text-xs text-ink-muted">
              {shown.length === rows.length
                ? t("共 {n} 隻", { n: rows.length })
                : t("{n} / {total} 隻", { n: shown.length, total: rows.length })}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("關閉")}
              className="shrink-0 rounded-full px-2 py-0.5 text-ink-muted transition hover:bg-card-soft hover:text-ink"
            >
              ✕
            </button>
          </div>
          {needNames.length > 0 && (
            <p className="mb-2 flex shrink-0 flex-wrap items-center gap-1 text-[11px] text-ink-muted">
              {t("這一步要帶")}
              {needNames.map((x) => (
                <span key={x} className="rounded bg-pal/12 px-1.5 py-0.5 font-bold text-pal">
                  {x}
                </span>
              ))}
              · {t("點卡片就用這一隻")}
            </p>
          )}
          {rows.length > 8 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("篩暱稱或詞條…")}
              className="mb-2 w-full shrink-0 rounded-lg bg-card-soft px-3 py-1.5 text-sm text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal"
            />
          )}
          {/* auto-fit:只有一隻時就撐滿整個寬度,多隻才自動排成兩欄以上 */}
          <div
            className="grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))" }}
          >
            {shown.map((r, i) => (
              <div
                key={`${r.pal.nickname}-${r.pal.level}-${i}`}
                // PalTile 的根是 <button>，在 grid 裡預設是 fit-content；
                // 補 w-full 才會撐滿欄寬（只有一隻時就是整個彈窗寬）
                className={`w-full [&>button]:w-full ${covers(r.pal) ? "rounded-cute ring-2 ring-grass" : ""}`}
              >
                {/* 主人名不重複印 —— 標題已經寫了「某某的某某」 */}
                <PalTile pal={r.pal} onClick={() => onChoose?.(r)} />
              </div>
            ))}
            {shown.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-ink-muted">{t("沒有符合的帕魯")}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** 由每輪成功率還原「突變時中獎率」:overall = 觸發率^k × Π中獎率。
 *  提示文字要同時給出兩個數字,免得 3.00% 被誤讀成中獎率。 */
function hitRateOf(info: StartCandidate, cake: CakeKind): number {
  if (!info.mutationSteps) return 1;
  return Math.min(1, info.overall / Math.pow(MUTATION_RATE[cake], info.mutationSteps));
}

/** 一顆「👥 誰有」小鈕:點開該帕魯的持有者面板。
 *
 *  放在帕魯名稱右邊(卡片內),所以不再重複顯示帕魯名 —— 旁邊就是了。
 *  卡片本身也可以點(換夥伴/換初代),因此這裡必須擋掉冒泡,
 *  不然點「看誰有」會順便把換夥伴的選單也打開。 */
function OwnerToggle({ id, on, onClick }: { id: string; on: boolean; onClick: () => void }): JSX.Element {
  useI18n();
  const name = palInfo(id.toLowerCase()).zh || id;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={t("查看誰有這隻 {name}", { name })}
      aria-label={t("查看誰有這隻 {name}", { name })}
      className={`shrink-0 cursor-pointer rounded-full px-1 py-0.5 text-[10px] leading-tight font-semibold ring-1 transition ${
        on ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink-muted ring-line hover:ring-pal hover:text-ink"
      }`}
    >
      👥
    </span>
  );
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v; v &= v - 1) c++;
  return c;
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
  resultId,
  resultMeta,
  resultOwned,
  onHover,
  nameAfter,
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
  /** 這一列配出來的子代 id —— 讓人一眼看出 A + B 生的是誰(不傳則不顯示) */
  resultId?: string;
  resultMeta?: PalMeta;
  resultOwned?: boolean;
  /** 滑入/滑出 A 格:開關「誰有這隻」的浮動說明 */
  onHover?: (rect: DOMRect | null) => void;
  /** 接在 A 格名稱右邊的東西(例:👥 看誰有這隻) */
  nameAfter?: ReactNode;
}): JSX.Element {
  const mix = 4 + Math.round((depth === 0 ? 1 : gen / depth) * 12);
  const badge = role === "target" ? `🎯 ${t("目標")}` : role === "start" ? `🏁 ${t("初代")}` : t("第 {n} 代", { n: gen });
  return (
    <div
      className={`flex h-full w-full flex-wrap items-center gap-1.5 rounded-cute px-2.5 py-2 shadow-cute ring-1 sm:gap-2.5 sm:px-3.5 sm:py-2.5 ${
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
        onHover={onHover}
        active={active}
        title={onClick ? t("點擊替換這一代") : undefined}
        big={role === "target"}
        nameAfter={nameAfter}
      />
      {/* B:夥伴(同一張卡片內,獨立點擊;顯示資訊與 A 相同) */}
      {partner && (
        <>
          <span className="shrink-0 text-lg font-bold text-ink-muted sm:text-xl">+</span>
          {partner}
        </>
      )}
      {/* = C:這一列配出來的子代,直接標在同一列,不必對照上一列 */}
      {resultId && (
        <>
          <span className="shrink-0 text-lg font-bold text-pal sm:text-xl">=</span>
          <PalCell id={resultId} meta={resultMeta} owned={resultOwned} compact />
        </>
      )}
      {/* 世代徽章放整列最右 */}
      <span
        className={`ml-auto w-14 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ring-1 sm:w-16 sm:text-[11px] ${
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
            ⚠ {t("目前限制路線必須從 {name} 起手 —— 清除初代或換一隻初代再試。", { name: fromName })}
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
              🔁 {t("換其他帶詞條的帕魯當初代(會重新計算路線與代數)")}
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
                /* 這一列 A+B 配出來的就是 s 本身。詞條梯度的目標列同時掛著「目標將繼承」的
                   說明,和配種列長得不一樣,所以每一列都標出結果,單代路線也看得懂。 */
                resultId={s.species}
                resultMeta={metaOf(s.species)}
                resultOwned={ownedOf(s)}
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


/** 混合/純突變路徑梯度:目標在頂,往下每列 = 一次配種,明確標出 A + B = C。 */
function HybridPathView({
  path,
  metaOf,
  ownedSet,
  cake,
  farm,
  boosted,
  mode,
  onPick,
  index,
  mut,
  startPool,
  onChangeStart,
  desired,
  ownedPool,
  ownersOf,
  detailsOf,
  scopeOwner,
}: {
  path: HybridPath;
  metaOf: (id: string) => PalMeta | undefined;
  ownedSet: Set<string> | null;
  cake: CakeKind;
  farm: FarmKind;
  boosted: boolean;
  mode: PathMode;
  onPick?: (id: string) => void;
  index: BreedingTableIndex;
  mut: MutationIndex;
  /** 這個模式下能當初代的帕魯(含代數與成功率),供直接在梯度上換初代 */
  startPool: Map<string, StartCandidate> | null;
  onChangeStart?: (id: string) => void;
  /** 要帶到目標身上的詞條(空陣列 = 沒開詞條篩選) */
  desired: string[];
  /** 可用的自有帕魯個體 —— 用來指出「誰有帶這些詞條的那一隻」 */
  ownedPool: SaveBreedingPal[];
  /** 物種 → 誰有幾隻;回 null = 玩家視角關掉了,不顯示 */
  ownersOf: (id: string) => { name: string; n: number }[] | null;
  /** 物種 → 個體明細(點持有者彈窗用) */
  detailsOf: (id: string) => OwnedPalRow[];
  /** 玩家視角鎖定的玩家名(全服視角為 undefined) */
  scopeOwner?: string;
}) {
  const has = (id: string) => (ownedSet ? ownedSet.has(id.toLowerCase()) : undefined);
  /** 使用者為某一步挑的夥伴(換路線時重置)。 */
  const [picked, setPicked] = useState<Record<number, StepOption>>({});
  const [openStep, setOpenStep] = useState<number | null>(null);
  /** 是否展開「換初代」清單 */
  const [openStart, setOpenStart] = useState(false);
  const [startQ, setStartQ] = useState("");
  useEffect(() => {
    setPicked({});
    setOpenStep(null);
    setOpenStart(false);
    setChosenPal({});
  }, [path]);
  const d = path.steps.length;
  const shrink = pyramidShrink(d);
  const rowWidth = (gen: number) => ({ width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" as const });
  const totalTime = humanDuration(eggsToSeconds(path.expectedEggs, cake, farm, boosted));

  /** 詞條交給解算器當硬條件:每一步都已標明「誰必須帶什麼進來」(bitmask),
   *  這裡只負責把 bitmask 換成真正的個體 —— 才答得出「這隻是誰的」。 */
  const maskOfPal = (c: SaveBreedingPal) => {
    let m = 0;
    desired.forEach((d, i) => {
      if (c.passives.includes(d)) m |= 1 << i;
    });
    return m;
  };
  /** 該物種中「帶得齊 mask」且雜詞條最少的個體(雜詞條少 → 遺傳時比較不會被擠掉)。 */
  const carrierFor = (species: string, mask: number): SaveBreedingPal | undefined => {
    if (!mask) return undefined;
    const sp = species.toLowerCase();
    let best: SaveBreedingPal | undefined;
    for (const c of ownedPool) {
      if (normalizeSpecies(c.characterId) !== sp) continue;
      if ((mask & ~maskOfPal(c)) !== 0) continue;
      if (!best || c.passives.length < best.passives.length) best = c;
    }
    return best;
  };
  const traitNames = (mask: number) => desired.filter((_, i) => mask & (1 << i));
  /** 解算器算過詞條(steps 帶著 mask)= 這條路線保證把詞條送到目標。 */
  const traitAware = desired.length > 0 && path.steps[0]?.fromNeed !== undefined;
  /** 哪一列的哪一格正在看持有者(key = `${列}:${a|b}`);一次只開一個 */
  const [openOwner, setOpenOwner] = useState<string | null>(null);
  /** 玩家自己指定的那一隻(key 同上);沒指定就用解算器挑的 */
  const [chosenPal, setChosenPal] = useState<Record<string, OwnedPalRow>>({});
  const poolOf = (id: string) => ownedPool.filter((c) => normalizeSpecies(c.characterId) === id.toLowerCase());
  /** 這一格實際要用誰的那一隻:玩家指定過就用指定的,否則用自動挑的。 */
  const carrierAt = (slot: string, species: string, mask: number): { ownerName: string } | undefined => {
    const own = chosenPal[slot];
    if (own) return { ownerName: own.owner.name };
    return carrierFor(species, mask);
  };
  /** 掛在帕魯格子底下的小字:要帶哪些詞條(誰的),或已經累積到幾個。
   *  資訊貼著它所描述的那一格,才不會被讀成在講整列或旁邊那隻。 */
  const traitSub = (mask: number, pal?: { ownerName: string }) =>
    mask > 0 || pal ? (
      <>
        {pal && <span className="shrink-0 font-semibold text-ink-muted">{pal.ownerName || "?"}</span>}
        {traitNames(mask).map((x) => (
          <span key={x} className="shrink-0 rounded bg-pal/12 px-1 py-px font-bold text-pal">
            {x}
          </span>
        ))}
      </>
    ) : undefined;
  /** 中間代/子代的詞條狀態:除了 n/m,把「已經到手的是哪幾個」也列出來,
   *  只看數字不知道中的是哪一個。缺的則用刪除線標出來,一眼看得出還差什麼。 */
  const countSub = (mask: number) => {
    const full = (1 << desired.length) - 1;
    const got = traitNames(mask);
    return (
      <>
        <span
          className={`shrink-0 rounded px-1 py-px font-bold ${
            mask === full ? "bg-grass/15 text-grass" : "bg-ink-muted/12 text-ink-muted"
          }`}
        >
          {got.length}/{desired.length}
        </span>
        {/* 已到手的綠標籤,還沒帶到的灰標籤 —— 原本的刪除線沒底色,看起來像散字很吵 */}
        {desired.map((x, i) => {
          const has = (mask & (1 << i)) !== 0;
          return (
            <span
              key={x}
              className={`shrink-0 rounded px-1 py-px font-semibold ${
                has ? "bg-grass/12 text-grass" : "bg-ink-muted/10 text-ink-muted/60"
              }`}
              title={has ? t("這一代已經帶著") : t("還沒帶到,後面要補")}
            >
              {x}
            </span>
          );
        })}
      </>
    );
  };
  return (
    <Card className="overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        <span className="text-sm font-bold text-ink">
          {mode === "mutation" ? t("全程變異路線") : t("直系 + 變異混合路線")}
        </span>
        <span>{t("共 {n} 代", { n: d })}</span>
        {path.mutationSteps > 0 && (
          <span>
            {t("其中 {n} 步靠突變", { n: path.mutationSteps })} · {t("整體每輪成功率")}{" "}
            <b className="text-ink">{(path.overall * 100).toFixed(3)}%</b>
          </span>
        )}
        <span>
          {t("期望")} <b className="text-ink">{Math.round(path.expectedEggs)}</b> {t("顆蛋")}
          <b className="ml-1 text-pal">≈ {totalTime}</b>
        </span>
        {traitAware && (
          <>
            <span className="flex flex-wrap items-center gap-1 font-semibold text-grass">
              ✓ {t("目標會帶齊全部 {n} 個詞條", { n: desired.length })}
              {desired.map((x) => (
                <span key={x} className="rounded bg-grass/12 px-1.5 py-px text-[10px] font-bold text-grass">
                  {x}
                </span>
              ))}
            </span>
            <span>
              {t("要湊")}{" "}
              <b className="text-ink">
                {path.steps.reduce(
                  (n, x, i) => n + ((x.partnerNeed ?? 0) > 0 ? 1 : 0) + (i === 0 && (x.fromNeed ?? 0) > 0 ? 1 : 0),
                  0,
                )}
              </b>{" "}
              {t("隻帶詞條的帕魯")}
            </span>
          </>
        )}
      </div>
      {/* 由目標往下回推:最上面是最後一次配種的結果 */}
      {[...path.steps].reverse().map((raw, i) => {
        const gen = d - 1 - i;
        const stepIdx = d - 1 - i;
        const isLast = i === 0;
        let opts = stepOptions(index, mut, raw.from, raw.child, mode, cake);
        // 詞條模式:這一步的夥伴要負責帶進 partnerNeed,換夥伴時只能換成同樣帶得動的,
        // 否則整條路線的保證就破了。
        const needMask = traitAware ? (raw.partnerNeed ?? 0) : 0;
        if (needMask) opts = opts.filter((o) => carrierFor(o.partner, needMask));
        const chosen = picked[stepIdx];
        // 沒挑過就用解算器給的;直系步驟解算器沒指定夥伴 → 用第一個合法選項
        const s = chosen
          ? { ...raw, partner: chosen.partner, kind: chosen.kind, chance: chosen.chance, perEgg: chosen.perEgg }
          : raw.partner
            ? raw
            : opts[0]
              ? { ...raw, partner: opts[0].partner, kind: opts[0].kind, chance: opts[0].chance, perEgg: opts[0].perEgg }
              : raw;
        return (
          <div key={i} className="mt-1.5">
            <div
              className={`flex flex-wrap items-center gap-1.5 rounded-cute px-2.5 py-2 shadow-cute ring-1 sm:gap-2.5 sm:px-3.5 ${
                isLast ? "ring-2 ring-pal" : "ring-line"
              }`}
              style={{
                ...rowWidth(gen),
                background: `color-mix(in oklab, var(--color-pal) ${4 + Math.round(((gen + 1) / (d || 1)) * 12)}%, var(--color-card))`,
              }}
            >
              {/* A(上一代留下來的) */}
              <PalCell
                id={s.from}
                meta={metaOf(s.from)}
                owned={has(s.from)}
                sub={
                  stepIdx === 0
                    ? traitSub(traitAware ? (s.fromNeed ?? 0) : 0, carrierAt(`${stepIdx}:a`, s.from, s.fromNeed ?? 0))
                    : traitAware
                      ? countSub(s.fromNeed ?? 0)
                      : undefined
                }
                active={stepIdx === 0 && openStart}
                nameAfter={
                  stepIdx === 0 ? (
                    <OwnerToggle
                      id={s.from}
                      on={openOwner === `${stepIdx}:a`}
                      onClick={() => setOpenOwner(openOwner === `${stepIdx}:a` ? null : `${stepIdx}:a`)}
                    />
                  ) : undefined
                }
                title={stepIdx === 0 ? t("點擊更換初代(會重新計算整條路線)") : undefined}
                onClick={
                  stepIdx === 0
                    ? () => { setOpenStart((v) => !v); setOpenStep(null); }
                    : onPick && (() => onPick(s.from))
                }
                hint={
                  stepIdx === 0 && startPool ? (
                    <span className="shrink-0 text-[11px] font-semibold text-ink-muted">▾{startPool.size}</span>
                  ) : undefined
                }
                compact
              />
              <span className="shrink-0 text-lg font-bold text-ink-muted sm:text-xl">+</span>
              {/* B(夥伴);直系步驟沒指定夥伴時顯示提示 */}
              {s.partner ? (
                <PalCell
                  id={s.partner}
                  meta={metaOf(s.partner)}
                  owned={has(s.partner)}
                  sub={traitSub(needMask, carrierAt(`${stepIdx}:b`, s.partner, needMask))}
                  active={openStep === stepIdx}
                  nameAfter={
                    <OwnerToggle
                      id={s.partner}
                      on={openOwner === `${stepIdx}:b`}
                      onClick={() => setOpenOwner(openOwner === `${stepIdx}:b` ? null : `${stepIdx}:b`)}
                    />
                  }
                  title={t("點擊更換夥伴(會顯示各夥伴的成功機率)")}
                  onClick={() => setOpenStep(openStep === stepIdx ? null : stepIdx)}
                  hint={opts.length > 1 ? <span className="shrink-0 text-[11px] font-semibold text-ink-muted">▾{opts.length}</span> : undefined}
                  compact
                />
              ) : (
                <span className="min-w-0 flex-1 basis-0 truncate rounded-xl bg-card-soft px-2 py-1.5 text-[13px] text-ink-muted ring-1 ring-line">
                  —
                </span>
              )}
              {/* = C:這一列配出來的結果,讓人一眼看出下一代是誰 */}
              <span className="shrink-0 text-lg font-bold text-pal sm:text-xl">=</span>
              <PalCell
                id={s.child}
                meta={metaOf(s.child)}
                owned={has(s.child)}
                sub={traitAware ? countSub(s.childNeed ?? 0) : undefined}
                compact
              />
              <span
                className={`ml-auto flex min-w-14 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ring-1 sm:min-w-16 sm:text-[11px] ${
                  s.kind === "mutation" ? "bg-berry/15 text-berry ring-berry/40" : "bg-pal/15 text-pal ring-pal/40"
                }`}
                title={s.kind === "mutation" ? t("這一代要靠突變蛋") : undefined}
              >
                {/* 靠突變的那一代直接掛變異圖示,不用讀到下面那行才知道 */}
                {s.kind === "mutation" && <img src={MUTATION_ICON} alt="" className="size-3.5 shrink-0" />}
                {isLast ? `🎯 ${t("目標")}` : t("第 {n} 代", { n: gen + 1 })}
              </span>
            </div>
            {stepIdx === 0 && openStart && startPool && (
              <div className="mt-1.5 rounded-xl bg-card-soft/80 p-2 ring-1 ring-pal/50" style={rowWidth(gen)}>
                <p className="mb-1.5 px-1 text-[11px] font-bold text-ink-muted">
                  🏁 {t("換初代 —— 以下都配得到目標,選了會重新排整條梯度")}
                </p>
                <input
                  value={startQ}
                  onChange={(e) => setStartQ(e.target.value)}
                  placeholder={t("搜尋帕魯…")}
                  className="mb-1.5 w-full rounded-lg bg-card px-3 py-1.5 text-sm text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal"
                />
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                  {[...startPool.entries()]
                    .filter(([id]) => {
                      const q = startQ.trim();
                      if (!q) return true;
                      return id.toLowerCase().includes(q.toLowerCase()) || Boolean(palInfo(id).zh?.includes(q));
                    })
                    .sort((x, y) => {
                      const ox = has(x[0]) ? 1 : 0;
                      const oy = has(y[0]) ? 1 : 0;
                      return oy - ox || x[1].depth - y[1].depth || y[1].overall - x[1].overall;
                    })
                    .slice(0, 60)
                    .map(([id, info]) => {
                      const inf = palInfo(id);
                      const on = id === s.from;
                      const own = has(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => { onChangeStart?.(id); setOpenStart(false); }}
                          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                            on ? "bg-pal text-white ring-pal" : own ? "bg-grass/10 text-ink ring-grass/40 hover:ring-pal" : "bg-card text-ink ring-line hover:ring-pal"
                          }`}
                        >
                          {inf.iconUrl && <img src={inf.iconUrl} alt="" className="size-5 rounded-full bg-card-soft" />}
                          {inf.zh || id}
                          <span className={on ? "text-white/85" : "text-ink-muted"}>{t("{n} 代", { n: info.depth })}</span>
                          {info.mutationSteps > 0 && (
                            <span
                              className={`flex items-center gap-0.5 ${on ? "text-white/85" : "text-berry"}`}
                              title={t("突變時中獎 {h}%,每顆蛋 {p}%,平均要 {n} 顆蛋", {
                                h: (hitRateOf(info, cake) * 100).toFixed(1),
                                p: (info.overall * 100).toFixed(2),
                                n: Math.round(info.expectedEggs),
                              })}
                            >
                              <img src={MUTATION_ICON} alt="" className="size-3.5" />
                              {t("中獎")} {(hitRateOf(info, cake) * 100).toFixed(1)}%
                            </span>
                          )}
                          {own && <span className={on ? "text-white/85" : "text-grass"}>✓</span>}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
            {openStep === stepIdx && opts.length > 0 && (
              <div className="mt-1.5 rounded-xl bg-card-soft/80 p-2 ring-1 ring-pal/50" style={rowWidth(gen)}>
                <p className="mb-1.5 px-1 text-[11px] font-bold text-ink-muted">
                  {t("選夥伴 —— 直系必得,變異看機率")}
                </p>
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                  {opts.slice(0, 60).map((o) => {
                    const inf = palInfo(o.partner);
                    const on = o.partner === s.partner && o.kind === s.kind;
                    const own = has(o.partner);
                    return (
                      <button
                        key={`${o.kind}-${o.partner}`}
                        type="button"
                        onClick={() => {
                          setPicked((prev) => ({ ...prev, [stepIdx]: o }));
                          setOpenStep(null);
                        }}
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                          on
                            ? "bg-pal text-white ring-pal"
                            : own
                              ? "bg-grass/10 text-ink ring-grass/40 hover:ring-pal"
                              : "bg-card text-ink ring-line hover:ring-pal"
                        }`}
                      >
                        {inf.iconUrl && <img src={inf.iconUrl} alt="" className="size-5 rounded-full bg-card-soft" />}
                        {inf.zh || o.partner}
                        {o.kind === "breed" ? (
                          <span className={on ? "text-white/85" : "text-grass"}>{t("直系")} 100%</span>
                        ) : (
                          <span
                            className={`flex items-center gap-0.5 ${on ? "text-white/85" : "text-berry"}`}
                            title={t("突變時中獎 {h}%,每顆蛋 {p}%,平均要 {n} 顆蛋", {
                              h: (o.chance * 100).toFixed(1),
                              p: (o.perEgg * 100).toFixed(2),
                              n: Math.round(1 / o.perEgg),
                            })}
                          >
                            <img src={MUTATION_ICON} alt="" className="size-3.5" />
                            {t("中獎")} {(o.chance * 100).toFixed(1)}%
                          </span>
                        )}
                        {own && <span className={on ? "text-white/85" : "text-grass"}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 誰有這隻:只有「你要自己準備」的那幾格需要查(最底列的 A、每一列的 B) */}
            {(() => {
              const slots: { key: string; id: string; need: number }[] = [];
              if (stepIdx === 0) slots.push({ key: `${stepIdx}:a`, id: s.from, need: traitAware ? (s.fromNeed ?? 0) : 0 });
              if (s.partner) slots.push({ key: `${stepIdx}:b`, id: s.partner, need: needMask });
              const open = slots.find((x) => x.key === openOwner);
              if (!slots.length) return null;
              if (!open) return null;
              // 觸發鈕已經移進卡片裡的帕魯名稱旁邊,這裡只負責展開後的面板。
              return (
                <>
                  {open && (
                    <OwnerPanel
                      id={open.id}
                      need={open.need}
                      desired={desired}
                      enabled={ownersOf(open.id) !== null}
                      scopeOwner={scopeOwner}
                      details={detailsOf(open.id)}
                      chosen={chosenPal[open.key]}
                      onChoose={(row) => setChosenPal((prev) => ({ ...prev, [open.key]: row }))}
                      style={rowWidth(gen)}
                      onClose={() => setOpenOwner(null)}
                    />
                  )}
                </>
              );
            })()}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-ink-muted" style={rowWidth(gen)}>
              {s.kind === "mutation" ? (
                <>
                  <span className="flex items-center gap-1 font-semibold text-berry">
                    <img src={MUTATION_ICON} alt="" className="size-3.5" /> {t("靠突變")}
                  </span>
                  <span>
                    {t("突變時中獎")} <b className="text-ink">{(s.chance * 100).toFixed(1)}%</b>
                  </span>
                  <span>
                    {t("每顆蛋")} <b className="text-ink">{(s.perEgg * 100).toFixed(2)}%</b>
                  </span>
                  <span>
                    {t("平均")} <b className="text-ink">{Math.round(1 / s.perEgg)}</b> {t("顆蛋")}
                    <b className="ml-1 text-pal">≈ {humanDuration(eggsToSeconds(1 / s.perEgg, cake, farm, boosted))}</b>
                  </span>
                </>
              ) : (
                <span className="font-semibold text-grass">✓ {t("直系配方,必定生得出")}</span>
              )}
            </div>
          </div>
        );
      })}
    </Card>
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
  { key: "chain", treeSub: "path", icon: "🪜", title: "最短路徑", sub: "初代到目標的最短配種路線" },
  { key: "pair", icon: "🥚", title: "配種計算", sub: "選兩隻父母,立刻看子代" },
  { key: "reverse", icon: "🔄", title: "反查組合", sub: "目標的全部父母組合" },
  { key: "chain", treeSub: "tree", icon: "🌳", title: "帕魯配種樹", sub: "樹狀展開 / 玩家視角" },
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
  /** 最短路徑的配種來源:純直系 / 直系+突變 / 全程突變 */
  const [pathMode, setPathMode] = useState<PathMode>("pure");
  const [cake, setCake] = useState<CakeKind>("deluxe");
  const [farm, setFarm] = useState<FarmKind>("normal");
  /** 據點內有滿星梁葉龍或寶寶保母(兩者不可疊加) */
  const [eggBoost, setEggBoost] = useState(false);
  /** 挑路線的偏好:代數最少 vs 期望蛋數最少(成功率最高) */
  const [strategy, setStrategy] = useState<PathStrategy>("short");
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

  /** 純直系梯度上哪一格正在看持有者(key = `${代}:${a|b}`) */
  const [pathOwner, setPathOwner] = useState<string | null>(null);

  /** 視角鎖定某位玩家時的名字(全服/全物種為 undefined)—— 用來讓「沒有人有」講對話。 */
  const scopeOwnerName = useMemo(
    () => (persp === "all" || persp === "any" || persp === "off" ? undefined : dataset?.players.find((p) => p.uid === persp)?.name),
    [dataset, persp],
  );

  /** 物種 → 這個視角下的個體(含主人)。持有者統計與明細都從這份推導,數字一定對得上。 */
  const palsBySpecies = useMemo<Map<string, OwnedPalRow[]> | null>(() => {
    if (!dataset || persp === "any" || persp === "off") return null;
    const out = new Map<string, OwnedPalRow[]>();
    for (const { pal, owner } of dataset.allPals) {
      if (persp !== "all" && owner.uid !== persp) continue;
      const sp = normalizeSpecies(pal.species);
      const list = out.get(sp);
      if (list) list.push({ pal, owner });
      else out.set(sp, [{ pal, owner }]);
    }
    return out;
  }, [dataset, persp]);

  /** 物種 → 誰擁有、各幾隻(多→少)。 */
  const ownersBySpecies = useMemo<Map<string, { name: string; n: number }[]> | null>(() => {
    if (!palsBySpecies) return null;
    const out = new Map<string, { name: string; n: number }[]>();
    for (const [sp, rows] of palsBySpecies) {
      const byOwner = new Map<string, number>();
      for (const r of rows) byOwner.set(r.owner.name, (byOwner.get(r.owner.name) ?? 0) + 1);
      out.set(
        sp,
        [...byOwner].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
      );
    }
    return out;
  }, [palsBySpecies]);

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

  /** 目前模式下,哪些帕魯已被選入插槽(卡片高亮用)。 */
  const selectedIds = useMemo(() => {
    if (mode === "pair") {
      const cur = pairs[Math.min(pairIdx, pairs.length - 1)];
      return new Set([cur?.a, cur?.b].filter(Boolean) as string[]);
    }
    if (mode === "reverse") return new Set([revTarget].filter(Boolean));
    if (mode === "chain")
      return new Set((treeSub === "tree" ? [treeTarget] : [chainFrom, chainTo]).filter(Boolean));
    return new Set<string>();
  }, [mode, pairs, pairIdx, revTarget, chainFrom, chainTo, treeSub, treeTarget]);

  /** 變異索引(資料抓不到就停用該模式)。 */
  const mutIndex = useMemo<MutationIndex | null>(() => (mutData ? buildMutationIndex(mutData) : null), [mutData]);

  /** 突變可達表(299×299 窗口計算,只在資料就緒時算一次)。 */
  const mutReach = useMemo<MutationReach | null>(() => (mutIndex ? buildMutationReach(mutIndex, null) : null), [mutIndex]);

  /** 目前配種來源下「能配到目標」的物種(不含詞條限制)。
   *  純變異模式下目標若不在突變名單裡,這裡就是空的 —— 詞條可行性也該跟著全部反灰。 */
  const modeReach = useMemo<Map<string, StartCandidate> | null>(() => {
    if (!index || !chainTo) return null;
    if (pathMode === "pure") {
      if (!startOptions) return null;
      const m = new Map<string, StartCandidate>();
      for (const [id, v] of startOptions)
        m.set(id, { depth: v.dist, overall: 1, expectedEggs: v.dist, mutationSteps: 0 });
      return m;
    }
    if (!mutIndex || !mutReach) return null;
    return startCandidates(index, mutIndex, mutReach, chainTo, pathMode, cake);
  }, [index, chainTo, pathMode, startOptions, mutIndex, mutReach, cake]);

  /** 詞條可行性:某詞條要能「配」到目標,至少要有一隻持有牠的自有帕魯
   *  (性別有效)且其物種在配種圖上真的能配到目標(startOptions)或就是目標本身。
   *  沒選目標時無從判斷,回 null = 不過濾。 */
  const feasibleTraits = useMemo<Set<string> | null>(() => {
    if (!dataset || !chainTo || !modeReach) return null;
    const reach = new Set([...modeReach.keys()].map((s) => s.toLowerCase()));
    // 純變異一定要經過突變蛋,目標自己身上的詞條帶不過去,所以不放行目標物種
    if (pathMode !== "mutation") reach.add(chainTo.toLowerCase());
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
  }, [dataset, chainTo, modeReach, pathMode, persp]);


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

  /** 詞條模式:物種 → 範圍內真的有人擁有的詞條組合(bitmask,只留極大值)。
   *  這是「誰真的有帶這些詞條的帕魯」的唯一事實來源,變異路線也吃這份資料。 */
  const traitMasks = useMemo<Map<string, number[]>>(() => {
    const out = new Map<string, number[]>();
    if (!index || desired.length === 0) return out;
    const idOf = new Map([...index.speciesSet].map((s) => [s.toLowerCase(), s]));
    const raw = new Map<string, Set<number>>();
    for (const c of ownedForTraits) {
      const id = idOf.get(normalizeSpecies(c.characterId));
      if (!id) continue;
      let mask = 0;
      desired.forEach((d, i) => {
        if (c.passives.includes(d)) mask |= 1 << i;
      });
      if (!mask) continue;
      const set = raw.get(id);
      if (set) set.add(mask);
      else raw.set(id, new Set([mask]));
    }
    // 只留極大值:被別的組合完全涵蓋的個體不會讓路線更好走
    for (const [id, set] of raw) {
      const all = [...set];
      out.set(
        id,
        all.filter((m) => !all.some((o) => o !== m && (m & ~o) === 0)),
      );
    }
    return out;
  }, [index, desired, ownedForTraits]);

  /** 帶詞條夥伴的突變可達表(夥伴池只有持有所選詞條的物種,遠比全表便宜)。 */
  const carrierReach = useMemo<MaskReach | null>(() => {
    if (!mutIndex || pathMode === "pure" || traitMasks.size === 0) return null;
    return buildCarrierReach(mutIndex, traitMasks);
  }, [mutIndex, pathMode, traitMasks]);

  /** 詞條 × 變異:一次反向建圖,同時得到「哪些初代帶得齊詞條」與各自的走法。
   *  找不到就是真的配不出來(而不是配得到但詞條掉了)。 */
  const traitGraph = useMemo<TraitGraph | null>(() => {
    if (pathMode === "pure" || desired.length === 0) return null;
    if (!index || !mutIndex || !mutReach || !chainTo) return null;
    return buildTraitGraph(
      index,
      mutIndex,
      mutReach,
      carrierReach ?? new Map(),
      chainTo,
      pathMode,
      cake,
      { desired, masks: traitMasks, inherit: MUTATION_INHERIT },
      6,
      strategy,
    );
  }, [pathMode, desired, index, mutIndex, mutReach, carrierReach, chainTo, cake, traitMasks, strategy]);

  /** 選完目標後,哪些帕魯能當初代(含要幾代、成功率)。三種模式共用,是選初代的唯一提示來源。 */
  const startPool = useMemo<Map<string, StartCandidate> | null>(() => {
    if (!index || !chainTo) return null;
    /** 選了詞條時,初代必須是「你擁有且帶該詞條」的物種 —— 詞條只能從初代帶上去。 */
    const withTraits = (m: Map<string, StartCandidate>) =>
      desired.length > 0 && traitCarrierSpecies
        ? new Map([...m].filter(([id]) => traitCarrierSpecies.has(id)))
        : m;
    // 有選詞條 → 初代清單直接來自詞條圖,每一筆都保證能把詞條帶到目標
    if (traitGraph) return traitGraph.starts;
    if (!modeReach) return null;
    return pathMode === "pure" ? withTraits(modeReach) : modeReach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, chainTo, pathMode, modeReach, desired, traitCarrierSpecies, traitGraph]);

  /** 混合/純突變路徑:pure 模式沿用原本的 solveChain,不走這裡。 */
  const hybrid = useMemo<HybridPath | null>(() => {
    if (pathMode === "pure" || !index || !mutIndex || !mutReach || !chainFrom || !chainTo) return null;
    if (traitGraph) return traitGraph.solve(chainFrom);
    return solveHybrid(index, mutIndex, mutReach, chainFrom, chainTo, pathMode, cake, 6, strategy);
  }, [pathMode, index, mutIndex, mutReach, chainFrom, chainTo, cake, strategy, traitGraph]);

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

  /** 最短路徑的「網格即候選」過濾:開著哪個替換面板,右側網格就只顯示該處的合法選項。 */
  const swapFilter = useMemo<Set<string> | null>(() => {
    // 選目標時:純變異模式只列「能由突變產出」的 143 隻
    if (mode === "chain" && treeSub === "path" && pathMode === "mutation" && activeSlot === "to")
      return mutIndex ? new Set(mutIndex.eligible.map((p) => p.id)) : null;
    // 選初代時:三種模式都只列「這個模式下到得了目標」的帕魯
    if (mode === "chain" && treeSub === "path" && activeSlot === "from" && startPool)
      return new Set(startPool.keys());
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
  }, [mode, treeSub, openTier, chain, targetOptions, startOptions, tierCandidates, activeSlot, chainTo, desired, traitCarrierSpecies, mutIndex, startPool]);

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

      {/* ---------------- 帕魯配種樹 ---------------- */}
      {mode === "chain" && (
        <>
          {/* 配種來源三段切換:純直系 / 直系+突變 / 全程突變 */}
          {treeSub === "path" && mutIndex && (
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
                  {(
                    [
                      ["pure", "🥚", "純粹帕魯配種", "只走直系配方,必定生得出"],
                      ["hybrid", "🧬", "包含變異可能性", "直系與突變都可用,優先代數少"],
                      ["mutation", "✨", "純粹變異配種", "全程靠突變蛋,代數最短但看運氣"],
                    ] as [PathMode, string, string, string][]
                  ).map(([k, icon, label, tip]) => (
                    <button
                      key={k}
                      type="button"
                      title={t(tip)}
                      onClick={() => setPathMode(k)}
                      className={`flex min-h-10 items-center gap-1 rounded-md px-3 text-xs font-semibold whitespace-nowrap transition sm:text-sm ${
                        pathMode === k ? "bg-pal text-white" : "text-ink hover:bg-card"
                      }`}
                    >
                      {k === "mutation" || k === "hybrid" ? (
                        <img src={MUTATION_ICON} alt="" className="size-4 shrink-0 object-contain" />
                      ) : (
                        <span>{icon}</span>
                      )}
                      {t(label)}
                    </button>
                  ))}
                </div>
                {pathMode !== "pure" && (
                  <>
                    {/* 蛋糕/牧場/加成 + 突變說明整合成一顆設定鈕,平常不佔版面 */}
                    <MutationSettings
                      cake={cake}
                      setCake={setCake}
                      farm={farm}
                      setFarm={setFarm}
                      boosted={eggBoost}
                      setBoosted={setEggBoost}
                      icon={MUTATION_ICON}
                    />
                    {/* 挑路線的偏好:代數最少 vs 最高成功率(期望蛋數最少) */}
                    <div className="flex rounded-lg bg-card-soft p-0.5 ring-1 ring-line">
                      {(
                        [
                          ["short", t("代數最少"), t("優先用最少代數到達目標")],
                          ["odds", t("成功率最高"), t("改用期望蛋數最少的走法:多繞一代但走高機率的突變,實際常常更省")],
                        ] as [PathStrategy, string, string][]
                      ).map(([k, label, tip]) => (
                        <button
                          key={k}
                          type="button"
                          title={tip}
                          onClick={() => setStrategy(k)}
                          className={`min-h-9 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition ${
                            strategy === k ? "bg-pal text-white" : "text-ink hover:bg-card"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* 玩家視角 + 詞條/主動技能兩個下拉(🪜/🌳 已提升為上層模式卡) */}
          {dataset && (
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <PerspSelect players={dataset.players} value={persp} onChange={setPersp} />
                {treeSub === "path" && traitOptions && (
                  <>
                    {(
                      [
                        // 寫「被動詞條」而不是「詞條」—— 才跟右邊的「主動技能」對稱,
                        // 一眼看得出這兩顆是「被動 vs 主動」而不是兩種不相干的東西。
                        ["passive", "🏷️", t("被動詞條")],
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
                  role={t("初代(你擁有)")}
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
                title={t("交換初代與目標")}
                aria-label={t("交換初代與目標")}
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
            {/* 選完目標就直接告訴你有哪些初代可用(三種模式都適用) */}
            {chainTo && !chainFrom && startPool && (
              <div className="mt-2.5 rounded-cute bg-card-soft p-2.5 ring-1 ring-line">
                {startPool.size === 0 ? (
                  <p className="text-sm text-ink-muted">
                    ⚠{" "}
                    {desired.length > 0
                      ? t("找不到能把這些詞條帶到 {name} 的初代 —— 減少詞條或擴大玩家視角範圍。", {
                          name: nameOf(chainTo),
                        })
                      : t("這個模式下沒有任何帕魯能配到 {name}", { name: nameOf(chainTo) })}
                  </p>
                ) : (
                  <>
                    <p className="mb-1.5 text-xs font-bold text-ink-muted">
                      👉{" "}
                      {desired.length > 0 && traitGraph
                        ? t("這 {n} 隻能當初代,把 {list} 帶到 {name} 身上", {
                            n: startPool.size,
                            list: desired.join("、"),
                            name: nameOf(chainTo),
                          })
                        : t("有 {n} 種帕魯能配到 {name},點下面或右側清單挑一隻當初代", {
                            n: startPool.size,
                            name: nameOf(chainTo),
                          })}
                    </p>
                    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                      {[...startPool.entries()]
                        .sort((x, y) => {
                          const ox = ownedSet?.has(x[0].toLowerCase()) ? 1 : 0;
                          const oy = ownedSet?.has(y[0].toLowerCase()) ? 1 : 0;
                          return oy - ox || x[1].depth - y[1].depth || y[1].overall - x[1].overall;
                        })
                        .slice(0, 40)
                        .map(([id, info]) => {
                          const inf = palInfo(id);
                          const own = ownedSet?.has(id.toLowerCase());
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                setChainFrom(id);
                                setAutoStart(false);
                                setActiveSlot(null);
                              }}
                              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition hover:ring-pal ${
                                own ? "bg-grass/10 text-ink ring-grass/40" : "bg-card text-ink ring-line"
                              }`}
                            >
                              {inf.iconUrl && <img src={inf.iconUrl} alt="" className="size-5 rounded-full bg-card-soft" />}
                              {inf.zh || id}
                              <span className="text-ink-muted">{t("{n} 代", { n: info.depth })}</span>
                              {info.mutationSteps > 0 && (
                                <span
                                  className="text-berry"
                                  title={t("突變時中獎 {h}%,每顆蛋 {p}%,平均要 {n} 顆蛋", {
                                    h: (hitRateOf(info, cake) * 100).toFixed(1),
                                    p: (info.overall * 100).toFixed(2),
                                    n: Math.round(info.expectedEggs),
                                  })}
                                >
                                  {t("中獎")} {(hitRateOf(info, cake) * 100).toFixed(1)}%
                                </span>
                              )}
                              {own && <span className="text-grass">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            )}
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
                  ⚡ {persp === "any" ? t("自動找最短初代(全部帕魯種類)") : t("從我擁有的帕魯自動找最短初代")}
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

          {treeSub === "path" && pathMode === "pure" && desired.length > 0 && chainTo && traitBusy && (
            <Card className="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-pal border-t-transparent" />
              {t("計算帶詞條路線中…")}
            </Card>
          )}
          {treeSub === "path" && pathMode === "pure" && desired.length > 0 && chainTo && !traitBusy && traitSolution && (
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
          {treeSub === "path" && pathMode === "pure" && desired.length > 0 && !chainTo && (
            <Card className="text-center text-sm text-ink-muted">{t("先選一隻目標帕魯,再看帶詞條路線。")}</Card>
          )}

          {treeSub === "path" && pathMode !== "pure" && chainFrom && chainTo && mutIndex && (
            hybrid ? (
              <HybridPathView
                path={hybrid}
                metaOf={metaOf}
                ownedSet={ownedSet}
                cake={cake}
                farm={farm}
                boosted={eggBoost}
                mode={pathMode}
                onPick={(id) => setChainFrom(id)}
                index={index}
                mut={mutIndex}
                startPool={startPool}
                onChangeStart={(id) => {
                  setChainFrom(id);
                  setAutoStart(false);
                }}
                desired={desired}
                ownedPool={ownedForTraits}
                ownersOf={(id) => ownersBySpecies?.get(id.toLowerCase()) ?? (ownersBySpecies ? [] : null)}
                detailsOf={(id) => palsBySpecies?.get(id.toLowerCase()) ?? []}
                scopeOwner={scopeOwnerName}
              />
            ) : desired.length > 0 ? (
              <Card className="text-center">
                <p className="font-bold text-ink">
                  {startPool && startPool.size > 0
                    ? t("這隻初代帶不齊詞條到 {name}", { name: nameOf(chainTo) })
                    : t("配不出帶齊這些詞條的 {name}", { name: nameOf(chainTo) })}
                </p>
                {startPool && startPool.size > 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    {t("換成下列 {n} 隻初代之一就帶得齊 —— 點梯度最底列或右側清單即可更換。", { n: startPool.size })}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-ink-muted">
                      {t("目標身上必須真的帶得到這 {n} 個詞條,否則就算配得出物種也不算數。", { n: desired.length })}
                    </p>
                    {desired.length > MUTATION_INHERIT && (
                      <p className="mt-2 rounded-xl bg-berry/8 px-3 py-2 text-left text-[13px] text-ink-muted ring-1 ring-berry/25">
                        <b className="text-berry">
                          {t("突變蛋只從父母繼承 {n} 個詞條", { n: MUTATION_INHERIT })}
                        </b>
                        {t("(另外兩格固定是彩虹詞條),所以最後一步是突變時帶不動 {n} 個詞條。", {
                          n: desired.length,
                        })}
                        {pathMode === "mutation"
                          ? t("改用「包含變異可能性」讓最後一步走直系,或把詞條減到 {n} 個以內。", {
                              n: MUTATION_INHERIT,
                            })
                          : t("減少詞條數量,或改用「純粹帕魯配種」。")}
                      </p>
                    )}
                    <p className="mt-2 text-[13px] text-ink-muted">
                      {t("也可以擴大玩家視角範圍(全服),讓更多人的帕魯進來當父母。")}
                    </p>
                  </>
                )}
              </Card>
            ) : (
              <Card className="text-center">
                <p className="font-bold text-ink">{t("這個模式下配不到目標")}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {pathMode === "mutation"
                    ? t("全程只走突變無法從初代到達目標 —— 改用「包含變異可能性」或換一隻初代。")
                    : t("6 代內找不到路線 —— 換一隻初代或目標再試。")}
                </p>
              </Card>
            )
          )}

          {treeSub === "path" && pathMode === "pure" && !desired.length && chainFrom && chainTo && !chain && (
            <Card className="text-center">
              {isSelfOnlyChild(index, chainTo) ? (
                <>
                  <p className="font-bold text-ink">{t("{name} 無法透過其他物種配種取得", { name: nameOf(chainTo) })}</p>
                  <p className="mt-1 text-sm text-ink-muted">{t("牠只能用兩隻同種配種繁殖 —— 請直接捕捉一對。")}</p>
                </>
              ) : (
                <>
                  <p className="font-bold text-ink">{t("從這個初代配不出目標")}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t("{name} 只能在特定家族內配種取得,請換一隻初代或直接捕捉。", { name: nameOf(chainTo) })}
                  </p>
                </>
              )}
            </Card>
          )}
          {treeSub === "path" && pathMode === "pure" && !desired.length && chain && chain.distance === 0 && (
            <Card className="text-center">
              <p className="font-bold text-ink">{t("初代就是目標帕魯")}</p>
              <p className="mt-1 text-sm text-ink-muted">{t("直接用兩隻 {name} 配種即可繁殖更多。", { name: nameOf(chainTo) })}</p>
            </Card>
          )}
          {treeSub === "path" && pathMode === "pure" && !desired.length && chain && chain.distance > 0 && (
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
                              /* 這一列 A+B 生出的是下一代的那隻。最後一次配種的結果就是頂端的目標,
                                 已經在目標列標過,這裡不再重複顯示 = 目標。 */
                              resultId={gen < d - 1 ? route.species[gen + 1] : undefined}
                              resultMeta={gen < d - 1 ? metaOf(route.species[gen + 1]) : undefined}
                              resultOwned={
                                gen < d - 1 && ownedSet ? ownedSet.has(route.species[gen + 1].toLowerCase()) : undefined
                              }
                              active={openTier === gen}
                              /* 只有初代那一列的 A 要自己準備,其餘代都是配出來的 */
                              nameAfter={
                                gen === 0 ? (
                                  <OwnerToggle
                                    id={sp}
                                    on={pathOwner === `${gen}:a`}
                                    onClick={() => setPathOwner(pathOwner === `${gen}:a` ? null : `${gen}:a`)}
                                  />
                                ) : undefined
                              }
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
                                          nameAfter={
                                            <OwnerToggle
                                              id={chosen.partner}
                                              on={pathOwner === `${gen}:b`}
                                              onClick={() => setPathOwner(pathOwner === `${gen}:b` ? null : `${gen}:b`)}
                                            />
                                          }
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

                          {/* 誰有這隻:最底列的 A 與每一列的 B 才需要自己準備 */}
                          {gen < d && (() => {
                            const rowStyle = { width: `calc(100% - ${2 * gen * shrink}%)`, marginInline: "auto" };
                            const slots = [
                              ...(gen === 0 ? [{ key: `${gen}:a`, id: sp }] : []),
                              { key: `${gen}:b`, id: chosenOf(gen).partner },
                            ];
                            const open = slots.find((x) => x.key === pathOwner);
                            if (!open) return null;
                            // 觸發鈕已移進卡片(帕魯名稱右邊),這裡只留展開後的面板。
                            return (
                              <>
                                {open && (
                                  <OwnerPanel
                                    id={open.id}
                                    need={0}
                                    desired={desired}
                                    enabled={palsBySpecies !== null}
                                    scopeOwner={scopeOwnerName}
                                    details={palsBySpecies?.get(open.id.toLowerCase()) ?? []}
                                    style={rowStyle}
                                    onClose={() => setPathOwner(null)}
                                  />
                                )}
                              </>
                            );
                          })()}

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
                {t("由下往上讀:每一列 A + B 配種,孵蛋後生出上一列;點 👥 看誰有那隻,點 A 換那一代的帕魯、點 B 換夥伴。")}
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
                          ? t("初代")
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
                            ? t("初代(你擁有)")
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
