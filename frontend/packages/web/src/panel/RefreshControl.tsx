// 自動更新控制 —— 仿 Grafana/Loki 的「重新整理鈕 + 間隔下拉」。
// 手動:點左半按鈕立即重載;自動:選一個間隔後定時重載。
// 選擇存 localStorage,重整頁面仍保留;分頁切到背景時暫停(回到前景會補一次)。
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { t, useI18n } from "../i18n";

/** 0 = 關閉自動更新 */
export const REFRESH_INTERVALS = [0, 5, 15, 30, 60, 300, 600] as const;
const STORAGE_KEY = "panel.refreshInterval";

function labelOf(sec: number): string {
  if (sec === 0) return t("關閉");
  // 60 保持顯示「60 秒」(與選單標示一致),超過才換算成分鐘
  if (sec <= 60) return `${sec} ${t("秒")}`;
  return `${sec / 60} ${t("分")}`;
}

function loadSaved(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return (REFRESH_INTERVALS as readonly number[]).includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function RefreshControl({ loading, onReload }: { loading: boolean; onReload: () => void }): JSX.Element {
  useI18n();
  const [interval, setIntervalSec] = useState<number>(loadSaved);
  const [open, setOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(interval));
    } catch {
      /* 隱私模式可能寫不進去,忽略 */
    }
  }, [interval]);

  // 每秒倒數;歸零就重載。分頁在背景時不倒數,避免積壓一堆請求。
  useEffect(() => {
    if (!interval) {
      setCountdown(0);
      return;
    }
    setCountdown(interval);
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setCountdown((c) => {
        if (c > 1) return c - 1;
        // 上一次還在載入就不重複打;維持在 1,載完的下一秒立刻補上,不必空等一整輪
        if (loadingRef.current) return 1;
        onReloadRef.current();
        return interval;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [interval]);

  const auto = interval > 0;
  return (
    <div ref={boxRef} className="relative flex items-center">
      <button
        onClick={onReload}
        className={`flex h-9 items-center gap-1.5 rounded-l-full border-2 border-r-0 px-3 transition ${
          auto ? "border-pal bg-pal/10 text-pal" : "border-line bg-card-soft text-ink-muted hover:border-pal hover:text-ink"
        }`}
        title={t("立即重新載入最新存檔資料")}
        aria-label={t("立即重新載入最新存檔資料")}
      >
        <FiRefreshCw size={16} className={loading ? "animate-spin" : ""} />
        {auto && <span className="text-xs font-bold tabular-nums">{countdown}s</span>}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 items-center gap-1 rounded-r-full border-2 px-2 text-xs font-semibold transition ${
          auto ? "border-pal bg-pal/10 text-pal" : "border-line bg-card-soft text-ink-muted hover:border-pal hover:text-ink"
        }`}
        title={t("自動更新間隔")}
        aria-label={t("自動更新間隔")}
      >
        {auto ? labelOf(interval) : t("手動")}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute top-11 right-0 z-30 w-36 overflow-hidden rounded-cute bg-card shadow-cute ring-1 ring-line">
          <p className="border-b border-line px-3 py-1.5 text-[11px] font-bold text-ink-muted">{t("自動更新")}</p>
          {REFRESH_INTERVALS.map((sec) => (
            <button
              key={sec}
              onClick={() => {
                setIntervalSec(sec);
                setOpen(false);
                if (sec > 0) onReload(); // 選了就先更新一次,不用等第一輪
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition ${
                sec === interval ? "bg-pal text-white" : "text-ink hover:bg-card-soft"
              }`}
            >
              {sec === 0 ? t("手動(不自動更新)") : labelOf(sec)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
