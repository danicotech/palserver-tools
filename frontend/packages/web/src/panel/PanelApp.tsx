// 玩家查詢系統外殼：導覽分頁 + 全域連線/重新整理 + 主題切換 + 帕魯詳情彈窗。
import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import { useDataset } from "./data";
import { useThemeMode, useSystemDark, isDarkNow, setThemeMode } from "./theme";
import { PalDetailModal } from "./PalDetailModal";
import { Dashboard } from "./Dashboard";
import { PlayerQuery } from "./PlayerQuery";
import { SpeciesQuery } from "./SpeciesQuery";
import { TraitQuery } from "./TraitQuery";
import { Rankings } from "./Rankings";
import { BossProgress } from "./BossProgress";
import { PaldexProgress } from "./PaldexProgress";
import { HeaderAvatar } from "./HeaderAvatar";
import { RosterProvider } from "./rosterCtx";
import { OnlineAnalysis } from "./OnlineAnalysis";
import { BreedingQuery } from "./BreedingQuery";
import { FiRefreshCw } from "react-icons/fi";
import { t, useI18n, LangSelect } from "../i18n";

type Tab = "dashboard" | "player" | "species" | "trait" | "breeding" | "paldex" | "boss" | "ranking" | "online";

// icon 與翻譯分開:label 在 render 時用 t() 取,才會隨語言即時切換。
const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "dashboard", icon: "📊", label: "總覽" },
  { key: "player", icon: "🧑", label: "玩家查詢" },
  { key: "species", icon: "🐾", label: "帕魯查詢" },
  { key: "trait", icon: "🏷️", label: "詞條查詢" },
  { key: "breeding", icon: "🥚", label: "配種表" },
  { key: "paldex", icon: "📖", label: "圖鑑收服率" },
  { key: "boss", icon: "👑", label: "首領進度" },
  { key: "ranking", icon: "🏆", label: "排行榜" },
  { key: "online", icon: "🕐", label: "上線分析" },
];
const tabLabel = (tab: { icon: string; label: string }) => `${tab.icon} ${t(tab.label)}`;

function ThemeToggle(): JSX.Element {
  const mode = useThemeMode();
  const sys = useSystemDark();
  const dark = isDarkNow(mode, sys);
  return (
    <button
      onClick={() => setThemeMode(dark ? "light" : "dark")}
      title={dark ? t("深色模式（點擊切換淺色）") : t("淺色模式（點擊切換深色）")}
      className="rounded-full border-2 border-line bg-card-soft p-2 text-ink transition hover:-translate-y-px hover:border-pal"
    >
      {dark ? "🌙" : "☀️"}
    </button>
  );
}

export function PanelApp(): JSX.Element {
  useI18n(); // 訂閱語言切換,讓整個面板(含子元件)隨語言重繪
  const [tab, setTab] = useState<Tab>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false); // 手機側邊漢堡選單
  const [selectedPal, setSelectedPal] = useState<{ pal: Pal; owner?: Player } | null>(null);
  const [speciesFilter, setSpeciesFilter] = useState<{ trait?: string; work?: string; query?: string; nonce: number } | null>(null);
  const [playerQuery, setPlayerQuery] = useState<{ q: string; pal?: string; nonce: number } | null>(null);
  const openPal = (pal: Pal, owner?: Player) => setSelectedPal({ pal, owner });

  // 從帕魯詳情跳轉到「帕魯查詢」並套用技能/工作篩選
  const jumpToSpecies = (f: { trait?: string; work?: string; query?: string }) => {
    setSpeciesFilter({ ...f, nonce: (speciesFilter?.nonce ?? 0) + 1 });
    setSelectedPal(null);
    setTab("species");
  };
  // 跳轉到「玩家查詢」：搜尋玩家名，並可選擇只顯示指定帕魯（pal）
  const jumpToPlayer = (name: string, pal?: string) => {
    setPlayerQuery({ q: name, pal, nonce: (playerQuery?.nonce ?? 0) + 1 });
    setSelectedPal(null);
    setTab("player");
  };
  const { data, loading, error, reload } = useDataset();

  // 漢堡選單開啟時鎖背景捲動、ESC 關閉。
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <RosterProvider>
    <div className="min-h-screen bg-sky-soft text-ink">
      <div className="px-3 py-5 sm:px-4 sm:py-6 xl:px-[200px]">
        {/* 標題列 */}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              <img src="/logo.png" alt="" className="size-8 shrink-0 rounded-full sm:size-9" />
              {t("帕魯玩家查詢工具網")}
            </h1>
            <p className="text-sm text-ink-muted">
              {t("查詢角色、帕魯、詞條與各種排行")}
              {data && <span className="ml-2">· {t("{n} 玩家", { n: data.players.length })} / {t("{n} 隻帕魯", { n: data.totalPals })}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HeaderAvatar players={data?.players ?? []} />
            <LangSelect />
            <button
              onClick={reload}
              className="flex size-9 items-center justify-center rounded-full border-2 border-line bg-card-soft text-ink-muted transition hover:border-pal hover:text-ink"
              title={t("重新載入最新存檔資料")}
              aria-label={t("重新載入最新存檔資料")}
            >
              <FiRefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* 手機/平板:漢堡列(顯示目前分頁,點擊開側邊選單);桌機(lg+):改用下方分頁列。
            8 個分頁在 <1024 寬度放不下,故此範圍一律用漢堡側邊選單。 */}
        <button
          onClick={() => setMenuOpen(true)}
          className="mb-4 flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-line bg-card px-4 py-2.5 text-left font-semibold text-ink shadow-cute transition hover:border-pal lg:hidden"
          aria-label={t("開啟分頁選單")}
          aria-expanded={menuOpen}
        >
          <span className="text-xl leading-none">☰</span>
          <span className="min-w-0 flex-1 truncate">{activeTab ? tabLabel(activeTab) : ""}</span>
          <span className="shrink-0 text-xs font-medium text-ink-muted">{t("切換分頁")}</span>
        </button>

        {/* 桌機(lg+):平均分配填滿寬度的分頁列 */}
        <nav className="mb-6 hidden gap-1 border-b border-line lg:flex">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`min-h-11 flex-1 whitespace-nowrap rounded-t-lg px-3 py-2.5 text-center text-sm font-medium transition ${
                tab === tb.key
                  ? "border-b-2 border-pal text-pal"
                  : "text-ink-muted hover:bg-card-soft hover:text-ink"
              }`}
            >
              {tabLabel(tb)}
            </button>
          ))}
        </nav>

        {/* 手機/平板側邊漢堡抽屜 */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("分頁選單")}>
            {/* 半透明遮罩 */}
            <div className="absolute inset-0 bg-[rgb(35_32_48/0.55)] backdrop-blur-[2px]" onClick={() => setMenuOpen(false)} />
            {/* 由左滑入的抽屜 */}
            <div className="drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col bg-card shadow-xl">
              <div className="flex items-center justify-between border-b-2 border-line px-4 py-3">
                <span className="text-base font-extrabold text-ink">🐾 {t("分頁選單")}</span>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="flex size-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-card-soft hover:text-ink"
                  aria-label={t("關閉選單")}
                >
                  ✕
                </button>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-2">
                {TABS.map((tb) => (
                  <button
                    key={tb.key}
                    onClick={() => {
                      setTab(tb.key);
                      setMenuOpen(false);
                    }}
                    className={`flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-base font-semibold transition ${
                      tab === tb.key
                        ? "bg-pal text-white shadow-cute"
                        : "text-ink hover:bg-card-soft"
                    }`}
                  >
                    {tabLabel(tb)}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* 內容(「配種表」查靜態配方資料,不依賴存檔資料集,載入中/失敗都照常顯示) */}
        {tab === "breeding" && <BreedingQuery dataset={data} />}
        {tab !== "breeding" && loading && <Placeholder text={t("載入存檔資料中")} />}
        {tab !== "breeding" && error && (
          <div className="rounded-cute bg-berry/15 px-4 py-3 text-berry ring-1 ring-berry/30">
            {error}
            <button onClick={reload} className="ml-2 underline">
              {t("重試")}
            </button>
          </div>
        )}
        {!loading && !error && data && (
          <>
            {tab === "dashboard" && <Dashboard data={data} onPalClick={openPal} onOwnerPlayerClick={jumpToPlayer} />}
            {tab === "player" && (
              <PlayerQuery
                key={playerQuery?.nonce ?? "base"}
                data={data}
                onPalClick={openPal}
                initialQuery={playerQuery?.q}
                initialPalQuery={playerQuery?.pal}
              />
            )}
            {tab === "species" && (
              <SpeciesQuery
                key={speciesFilter?.nonce ?? "base"}
                data={data}
                onPalClick={openPal}
                initialFilter={speciesFilter ?? undefined}
              />
            )}
            {tab === "trait" && <TraitQuery data={data} onPalClick={openPal} />}
            {tab === "paldex" && <PaldexProgress data={data} onOwnerPlayerClick={jumpToPlayer} />}
            {tab === "boss" && <BossProgress data={data} onOwnerPlayerClick={jumpToPlayer} />}
            {tab === "ranking" && <Rankings data={data} onPalClick={openPal} />}
            {tab === "online" && <OnlineAnalysis data={data} />}
          </>
        )}
      </div>

      {selectedPal && (
        <PalDetailModal
          pal={selectedPal.pal}
          owner={selectedPal.owner}
          onClose={() => setSelectedPal(null)}
          onFilter={jumpToSpecies}
          onOwnerClick={jumpToPlayer}
        />
      )}
    </div>
    </RosterProvider>
  );
}

function Placeholder({ text }: { text: string }): JSX.Element {
  return (
    <div className="rounded-cute bg-card px-6 py-16 text-center text-ink-muted shadow-cute ring-1 ring-line">
      <LoadingWave text={text} />
    </div>
  );
}

/** 載入文字特效:逐字波浪起伏 + 尾巴三點一個個浮現,循環播放(尊重減少動態偏好)。 */
function LoadingWave({ text }: { text: string }): JSX.Element {
  const chars = [...text];
  return (
    <span className="loading-wave text-lg text-ink" role="status" aria-label={`${text}…`}>
      {chars.map((c, i) => (
        <span
          key={i}
          className="loading-wave__ch"
          style={{ animationDelay: `${i * 0.07}s` }}
          aria-hidden="true"
        >
          {c === " " ? " " : c}
        </span>
      ))}
      <span className="loading-wave__dots" aria-hidden="true">
        <span style={{ animationDelay: "0s" }}>.</span>
        <span style={{ animationDelay: "0.18s" }}>.</span>
        <span style={{ animationDelay: "0.36s" }}>.</span>
      </span>
    </span>
  );
}
