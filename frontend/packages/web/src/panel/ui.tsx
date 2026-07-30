// 玩家查詢頁的共用小元件與樣式工具。
import type { JSX } from "react";
import { t } from "../i18n";

// 屬性 → 顏色（繁中屬性名）。
const ELEMENT_COLORS: Record<string, string> = {
  火: "bg-orange-500/85",
  水: "bg-sky-500/85",
  草: "bg-lime-500/85",
  雷: "bg-yellow-400/90 text-black",
  電: "bg-yellow-400/90 text-black",
  冰: "bg-cyan-400/85 text-black",
  龍: "bg-violet-500/85",
  暗: "bg-fuchsia-800/85",
  地: "bg-amber-700/85",
  無: "bg-neutral-500/80",
};

/** 排行長條可用的主題色票(每種排行選一種);bg-pal 會隨主題換色,其餘為語意強調色。 */
export const RANK_BAR_COLORS = ["bg-pal", "bg-sponsor", "bg-sun", "bg-grass", "bg-berry"] as const;

/** 排行 / 貢獻共用長條:可帶主題色票 + 由左長出的 bar-fill 動畫。
 *  需在有 data-seen="true" 的祖先內才會播放動畫(沿用總覽排行同一套,見 panel.css)。
 *  color 傳 RANK_BAR_COLORS 之一(bg-* class);預設 bg-pal。 */
export function RankBar({
  pct,
  delayMs = 0,
  className = "",
  color = "bg-pal",
}: {
  pct: number;
  delayMs?: number;
  className?: string;
  color?: string;
}): JSX.Element {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-card-soft ${className}`}>
      <div
        className={`bar-fill h-full rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, animationDelay: `${delayMs}ms` }}
      />
    </div>
  );
}

/** 在線狀態動畫綠點(Tailwind ping 光暈 + 實心點),全站共用同一個動畫。 */
export function OnlineDot({ className = "" }: { className?: string }): JSX.Element {
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`} role="img" aria-label={t("在線")} title={t("在線")}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-grass opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-grass" />
    </span>
  );
}

export function ElementBadge({ el, size = "sm" }: { el: string; size?: "sm" | "lg" }): JSX.Element {
  const cls = ELEMENT_COLORS[el] ?? "bg-neutral-600/80";
  const sz = size === "lg" ? "px-4 py-1.5 text-base font-bold" : "px-2 py-0.5 text-xs font-medium";
  return <span className={`inline-flex items-center rounded-full text-white ${sz} ${cls}`}>{el}</span>;
}

export function RankStars({ rank }: { rank: number }): JSX.Element {
  const n = Math.max(0, Math.min(5, rank));
  return (
    <span className="text-amber-400" title={t("星級 {n}", { n })}>
      {"★".repeat(n)}
      <span className="text-neutral-600">{"★".repeat(5 - n)}</span>
    </span>
  );
}

// 個體值長條（0..100）。
export function IvBar({ label, value }: { label: string; value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 90 ? "bg-grass" : pct >= 60 ? "bg-sun" : "bg-ink-muted";
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-soft">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink-muted">{value}</span>
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "sky" | "rose";
}): JSX.Element {
  const tones = {
    neutral: "bg-card-soft text-ink-muted ring-1 ring-line",
    amber: "bg-sun/20 text-sun ring-1 ring-sun/40",
    sky: "bg-pal/20 text-pal ring-1 ring-pal/40",
    rose: "bg-berry/20 text-berry ring-1 ring-berry/40",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

// 工作適應性 → 官方圖示 index（爬自 paldb.cc，存於 /game-data/work/）。
// 依 EPalWorkSuitability 列舉順序 0..12。
export const WORK_ICON_IDX: Record<string, string> = {
  點火: "00",
  灌溉: "01",
  播種: "02",
  發電: "03",
  手工: "04",
  採集: "05",
  伐木: "06",
  採礦: "07",
  原油提取: "08",
  製藥: "09",
  製冷: "10",
  搬運: "11",
  牧場: "12",
};

export function workIconUrl(w: string): string | null {
  const idx = WORK_ICON_IDX[w];
  return idx ? `/game-data/work/T_icon_palwork_${idx}.webp` : null;
}

/** 工作適應性圖示（查無則回退文字）。 */
export function WorkIcon({ work, size = 16 }: { work: string; size?: number }): JSX.Element {
  const url = workIconUrl(work);
  if (!url) return <span className="text-xs">{work}</span>;
  return (
    <img
      src={url}
      alt={work}
      title={work}
      loading="lazy"
      style={{ width: size, height: size }}
      className="inline-block shrink-0"
    />
  );
}

/** 工作適應性：圖示 + 數字（無外框）。 */
export function WorkChip({ work, level, showName = false }: { work: string; level?: number; showName?: boolean }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 text-sm text-ink" title={work}>
      <WorkIcon work={work} size={18} />
      {showName && <span className="text-xs text-ink-muted">{work}</span>}
      {level != null && <span className="font-semibold tabular-nums text-pal">{level}</span>}
    </span>
  );
}

export function fmtNum(n: number | null | undefined): string {
  // palsave 對部分欄位（如 hp、shield_hp）可能回傳 null；顯示為破折號而非崩潰。
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}
