// Chart.js 圖表元件（含載入動畫 + 圖表類型切換 + 深淺色主題）。
// 參考 Chart.js 官方範例的甜甜圈/折線/長條樣式。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  type Plugin,
} from "chart.js";
import { Doughnut, Pie, Bar, Line } from "react-chartjs-2";
import { useThemeMode, useSystemDark, isDarkNow } from "./theme";
import { t } from "../i18n";

ChartJS.register(ArcElement, LineElement, BarElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

export interface Slice {
  label: string;
  value: number;
  color: string;
}

export type ChartKind = "doughnut" | "pie" | "bar" | "line";
const KIND_LABEL: Record<ChartKind, string> = { doughnut: "甜甜圈", pie: "圓餅", bar: "長條", line: "折線" };

function useIsDark(): boolean {
  const mode = useThemeMode();
  const sys = useSystemDark();
  return isDarkNow(mode, sys);
}

/** 元素首次進入視窗時回傳 true（供載入動畫），只觸發一次。 */
export function useInView<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

// 折線「由左往右畫出」的平滑動畫：以 rAF 自行推進一個 clip 遮罩由左往右揭開，
// 折線/面積先一次畫好（靜態），只做剪裁揭露 → 連續順暢，且不受 React 重繪打斷。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineReveal: any = {
  id: "lineReveal",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeInit(chart: any) {
    chart.$reveal = 0;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterInit(chart: any) {
    chart.$revealRunning = true;
    const dur = 1000;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!chart.$revealRunning || !chart.ctx) return;
      if (start === null) start = ts;
      const raw = (ts - start) / dur;
      const t = raw >= 1 ? 1 : raw < 0 ? 0 : raw;
      chart.$reveal = 1 - Math.pow(1 - t, 3); // easeOutCubic
      chart.draw();
      if (raw < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeDatasetsDraw(chart: any) {
    chart.$clipOn = false;
    const a = chart.chartArea;
    if (!a || !chart.ctx) return;
    const p = chart.$reveal ?? 1;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left, a.top, (a.right - a.left) * p, a.bottom - a.top);
    ctx.clip();
    chart.$clipOn = true; // 僅在有 save 時才 restore，保持 save/restore 平衡
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterDatasetsDraw(chart: any) {
    if (chart.$clipOn && chart.ctx) chart.ctx.restore();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeDestroy(chart: any) {
    chart.$revealRunning = false;
  },
};

/** 進入視窗才播放子元素進場動畫（在 data-seen 上掛 CSS 動畫）。 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-seen={seen} className={className}>
      {children}
    </div>
  );
}

// 甜甜圈中央文字（總數）外掛。
const centerText: Plugin<"doughnut"> = {
  id: "centerText",
  afterDraw(chart) {
    const opts = (chart.options.plugins as { centerText?: { text?: string; sub?: string; color?: string; subColor?: string } })
      ?.centerText;
    if (!opts?.text) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return; // resize/佈局未就緒時 chartArea 可能為 undefined，避免整頁崩潰
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    const size = Math.min(chartArea.right - chartArea.left, chartArea.bottom - chartArea.top) * 0.2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color ?? "#111";
    ctx.font = `700 ${size}px sans-serif`;
    ctx.fillText(opts.text, cx, opts.sub ? cy - size * 0.35 : cy);
    if (opts.sub) {
      ctx.font = `500 ${size * 0.45}px sans-serif`;
      ctx.fillStyle = opts.subColor ?? "#999";
      ctx.fillText(opts.sub, cx, cy + size * 0.5);
    }
    ctx.restore();
  },
};

/** 可切換類型的圖表（甜甜圈/圓餅/長條/折線），Chart.js 載入動畫內建。 */
export function SwitchChart({
  labels,
  values,
  colors,
  kinds,
  primary = "#7c6cf0",
  centerLabel,
  centerSub,
  height = 260,
  fill = false,
  unit = "",
  tooltipItems,
}: {
  labels: string[];
  values: number[];
  colors?: string[];
  kinds: ChartKind[];
  primary?: string;
  centerLabel?: string;
  centerSub?: string;
  height?: number;
  fill?: boolean; // 撐滿父層高度（用 flex-1）
  unit?: string;
  // 每個資料點自訂 tooltip 內容(例如各等級區間的玩家名單);提供時取代預設「數值」顯示。
  tooltipItems?: string[][];
}): JSX.Element {
  const dark = useIsDark();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [kind, setKind] = useState<ChartKind>(kinds[0]);
  // 自訂名單 tooltip 用 HTML 呈現(不受 canvas 邊界裁切,可長、可自動避開螢幕邊緣)。
  const htmlTipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tooltipItems) return;
    const el = document.createElement("div");
    el.className = "lwt";
    el.style.opacity = "0";
    document.body.appendChild(el);
    htmlTipRef.current = el;
    return () => {
      el.remove();
      htmlTipRef.current = null;
    };
  }, [tooltipItems]);
  const ink = dark ? "#e5e7eb" : "#334155";
  const muted = dark ? "#94a3b8" : "#64748b";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(2,6,23,0.06)";
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const isCircular = kind === "doughnut" || kind === "pie";
  const palette = colors ?? values.map(() => primary);

  // 記憶化 data / options：避免父層每次重繪都產生新物件 → react-chartjs-2 觸發 chart.update()
  //（那正是進場動畫被反覆打斷、卡頓的主因）。只有實際輸入變動時才重建。
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: centerSub ?? t("數量"),
          data: values,
          backgroundColor: kind === "line" ? primary + "22" : isCircular || kind === "bar" ? palette : primary,
          borderColor: kind === "line" ? primary : isCircular ? (dark ? "#0b1220" : "#ffffff") : primary,
          borderWidth: isCircular ? 2 : kind === "line" ? 2.5 : 0,
          fill: kind === "line",
          tension: 0.35,
          pointBackgroundColor: primary,
          pointRadius: kind === "line" ? 3 : 0,
          pointHoverRadius: 5,
          borderRadius: kind === "bar" ? 6 : 0,
          hoverOffset: isCircular ? 6 : 0,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, values, palette, kind, dark, primary, isCircular, centerSub],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 120, // 合併連續 resize，避免撐滿高度時鄰欄佈局變動反覆重繪
      // 折線用 clip-reveal 外掛做揭露動畫，本身關動畫；其餘用內建進場動畫。resize 不重播動畫。
      animation: kind === "line" ? false : { duration: 1100, easing: "easeOutQuart" as const, animateScale: true, animateRotate: true },
      transitions: { resize: { animation: { duration: 0 } } },
      cutout: kind === "doughnut" ? "62%" : undefined,
      plugins: {
        legend: {
          display: isCircular,
          position: "right" as const,
          labels: { color: ink, boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } },
        },
        tooltip: {
          // 自訂名單改用 HTML tooltip(external),避免 canvas 邊界把長名單裁掉。
          enabled: !tooltipItems,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          external: tooltipItems
            ? (context: any) => {
                const el = htmlTipRef.current;
                if (!el) return;
                const tt = context.tooltip;
                if (!tt || tt.opacity === 0) {
                  el.style.opacity = "0";
                  return;
                }
                const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
                const title = (tt.title && tt.title[0]) || "";
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const lines: string[] = (tt.body || []).flatMap((b: any) => b.lines || []);
                el.innerHTML =
                  `<div class="lwt-t">${esc(title)}</div>` +
                  `<div class="lwt-body">${lines.map((l) => `<div class="lwt-l">${esc(l.trim())}</div>`).join("")}</div>`;
                // 名單多時把 tooltip 加寬 → 觸發多欄排版,避免單欄過高被畫面裁掉。
                el.style.width = lines.length > 12 ? "min(440px, 86vw)" : "auto";
                // 量測後智慧定位:優先在游標上方置中,空間不足改到下方,並夾在畫面內。
                el.style.opacity = "1";
                el.style.left = "0px";
                el.style.top = "0px";
                const rect = context.chart.canvas.getBoundingClientRect();
                const tw = el.offsetWidth;
                const th = el.offsetHeight;
                const cx = rect.left + tt.caretX;
                const cy = rect.top + tt.caretY;
                let left = cx - tw / 2;
                let top = cy - th - 12;
                if (top < 8) top = cy + 16;
                left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
                top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
                el.style.left = `${left}px`;
                el.style.top = `${top}px`;
              }
            : undefined,
          callbacks: {
            label: (ctx: { label?: string; parsed: number | { y: number }; dataIndex: number }) => {
              // 自訂名單模式:顯示該點的字串清單(例如玩家姓名),而非數值。
              if (tooltipItems) {
                const items = tooltipItems[ctx.dataIndex] ?? [];
                if (!items.length) return t(" （無）");
                const shown = items.slice(0, 40);
                const lines = shown.map((s) => ` ${s}`);
                if (items.length > shown.length) lines.push(` ${t("…及其他 {n} 位", { n: items.length - shown.length })}`);
                return lines;
              }
              const v = typeof ctx.parsed === "number" ? ctx.parsed : ctx.parsed.y;
              const pct = isCircular ? ` (${((v / total) * 100).toFixed(1)}%)` : "";
              return ` ${ctx.label}: ${v}${unit}${pct}`;
            },
          },
        },
        centerText: kind === "doughnut" ? { text: centerLabel, sub: centerSub, color: ink, subColor: muted } : undefined,
      },
      scales: isCircular
        ? {}
        : {
            x: { ticks: { color: muted, font: { size: 11 } }, grid: { display: false } },
            y: { ticks: { color: muted, font: { size: 11 }, precision: 0 }, grid: { color: grid }, beginAtZero: true },
          },
    }),
    [kind, isCircular, ink, muted, grid, total, unit, centerLabel, centerSub, tooltipItems],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const common = { data: data as any, options: options as any };

  return (
    <div className={fill ? "flex h-full flex-col" : ""}>
      {kinds.length > 1 && (
        <div className="mb-2 flex shrink-0 justify-end">
          <div className="inline-flex rounded-lg border border-line bg-card-soft p-0.5 text-xs">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-md px-2.5 py-1.5 transition ${kind === k ? "bg-pal text-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
              >
                {t(KIND_LABEL[k])}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* key 綁 kind+seen：切換類型或進入視窗時重新掛載 → 重播載入動畫 */}
      <div ref={ref} className={fill ? "min-h-0 flex-1" : ""} style={fill ? { minHeight: height } : { height }}>
        {/* key 綁 kind：切換類型會重新掛載 → 重播原生進場動畫（折線逐點畫出／甜甜圈掃入） */}
        {seen && (
          <div key={kind} className="h-full">
            {kind === "doughnut" && <Doughnut {...common} plugins={[centerText]} />}
            {kind === "pie" && <Pie {...common} />}
            {kind === "bar" && <Bar {...common} />}
            {kind === "line" && <Line {...common} plugins={[lineReveal]} />}
          </div>
        )}
      </div>
    </div>
  );
}
