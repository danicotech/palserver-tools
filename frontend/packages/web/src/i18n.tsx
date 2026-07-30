import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { FiChevronDown } from "react-icons/fi";

/**
 * i18n:繁中(zh-TW,原文)/ 簡中 / 英 / 日。
 *
 * 設計:程式碼裡的字串一律寫繁中原文,t() 拿原文當 key 查字典;其他語言字典是
 * public/i18n/{zh-CN,en,ja}.json 的「繁中 → 譯文」對照表,查不到就顯示繁中原文,
 * 所以漏翻不會壞版面。插值用 {名稱} 佔位,例:t("第 {n} 天", { n })。
 *
 * 簡中使用同源 bundled 檔(/i18n/zh-CN.json),確保人工校對版本不被遠端覆蓋。
 * 英/日則比照 promoConfig:localStorage 快取 → bundled → GitHub raw 背景更新。
 */

export type Lang = "zh" | "zh-CN" | "en" | "ja";

export const LANG_LABELS: Record<Lang, string> = {
  zh: "繁體中文",
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
};

const KEY = "palserver.lang";
const DICT_CACHE_PREFIX = "palserver.i18n.";
const LOCAL_BASE = "/i18n/";
const REMOTE_BASE =
  "https://raw.githubusercontent.com/io-software-ai/palserver-gui/main/packages/web/public/i18n/";

type Dict = Record<string, string>;

function isLang(value: string | null): value is Lang {
  return value === "zh" || value === "zh-CN" || value === "en" || value === "ja";
}

function htmlLang(l: Lang): string {
  return l === "zh" ? "zh-TW" : l;
}

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("zh")) {
    return /(^|-)zh-(tw|hk|mo|hant)(-|$)/.test(nav) ? "zh" : "zh-CN";
  }
  if (nav.startsWith("ja")) return "ja";
  return "en";
}

let lang: Lang = detectLang();
const dicts: Partial<Record<Lang, Dict>> = {};
const loaded = new Set<Lang>(); // 這個 session 已經跑過載入流程的語言
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readDictCache(l: Lang): Dict | null {
  try {
    return JSON.parse(localStorage.getItem(DICT_CACHE_PREFIX + l) ?? "null");
  } catch {
    return null;
  }
}

async function loadDict(l: Lang): Promise<void> {
  if (l === "zh" || loaded.has(l)) return;
  loaded.add(l);

  if (l === "zh-CN") {
    try {
      const res = await fetch(`${LOCAL_BASE}${l}.json`, {
        cache: "no-cache",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        dicts[l] = (await res.json()) as Dict;
        try {
          localStorage.removeItem(DICT_CACHE_PREFIX + l);
        } catch {
          /* ignore */
        }
        notify();
        return;
      }
    } catch {
      /* 同源檔不可用時再嘗試舊快取 */
    }
    const cached = readDictCache(l);
    if (cached) {
      dicts[l] = cached;
      notify();
    }
    return;
  }

  // bundled 一定要拿:它含本版新增的鍵。快取/遠端(上游)可能缺新鍵,
  // 一律「bundled 墊底、遠端逐鍵覆蓋」合併,否則整包取代會把新功能字串打回原文。
  let bundled: Dict | null = null;
  try {
    const res = await fetch(`${LOCAL_BASE}${l}.json`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) bundled = (await res.json()) as Dict;
  } catch {
    /* 沒有 bundled 檔就先用原文 */
  }
  const cached = readDictCache(l);
  if (bundled || cached) {
    dicts[l] = { ...(bundled ?? {}), ...(cached ?? {}) };
    notify();
  }
  // 遠端(GitHub)為準(逐鍵覆蓋在 bundled 之上),抓到有變才更新;快取存遠端原始檔
  try {
    const res = await fetch(`${REMOTE_BASE}${l}.json`, {
      cache: "no-cache",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const remote = (await res.json()) as Dict;
      const merged: Dict = { ...(bundled ?? {}), ...remote };
      if (JSON.stringify(merged) !== JSON.stringify(dicts[l] ?? null)) {
        dicts[l] = merged;
        try {
          localStorage.setItem(DICT_CACHE_PREFIX + l, JSON.stringify(remote));
        } catch {
          /* 存不進去就下次再抓 */
        }
        notify();
      }
    }
  } catch {
    /* 離線就用現有的 */
  }
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* 無痕模式等存不進去就只作用當次 */
  }
  document.documentElement.lang = htmlLang(next);
  void loadDict(next);
  notify();
}

/** 翻譯:原文(中文)→ 目前語言;插值 {k} 以 params[k] 代入。 */
export function t(source: string, params?: Record<string, string | number>): string {
  let out = (lang !== "zh" && dicts[lang]?.[source]) || source;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** 將遊戲自動產生的日文據點模板名換成目前介面的語言;自訂名稱保持原樣。 */
export function localizeBaseName(name: string, index: number): string {
  return !name || /^新規生成拠点テンプレート名\d+\(仮\)$/.test(name)
    ? t("據點 {n}", { n: index + 1 })
    : name;
}

/** React 入口:訂閱語言/字典變化,回傳 t 與目前語言。 */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { lang, setLang, t };
}

/** 啟動:套 <html lang> 並預載目前語言的字典(main.tsx 掛載前呼叫)。 */
export function initI18n(): void {
  document.documentElement.lang = htmlLang(lang);
  void loadDict(lang);
}

// 各語言以 SVG 國旗表示(用 SVG 而非 emoji：Windows 的 Chrome/Edge 不會把國旗 emoji
// 畫成國旗,只會顯示 "TW"/"CN" 字母；SVG 可確保各平台一致)。viewBox 20×14 圓角。
const FLAGS: Record<Lang, JSX.Element> = {
  zh: (
    <svg viewBox="0 0 20 14" className="h-full w-full" aria-hidden>
      <rect width="20" height="14" fill="#fe0000" />
      <rect width="10" height="7" fill="#000095" />
      <circle cx="5" cy="3.5" r="1.9" fill="#fff" />
      <circle cx="5" cy="3.5" r="1.15" fill="#000095" />
      <circle cx="5" cy="3.5" r="0.7" fill="#fff" />
    </svg>
  ),
  "zh-CN": (
    <svg viewBox="0 0 20 14" className="h-full w-full" aria-hidden>
      <rect width="20" height="14" fill="#de2910" />
      <text x="2.5" y="9.5" fontSize="7" fill="#ffde00">★</text>
      <text x="8" y="4" fontSize="2.6" fill="#ffde00">★</text>
      <text x="9.6" y="6" fontSize="2.6" fill="#ffde00">★</text>
    </svg>
  ),
  en: (
    <svg viewBox="0 0 20 14" className="h-full w-full" aria-hidden>
      <rect width="20" height="14" fill="#fff" />
      {[0, 4, 8, 12].map((y) => <rect key={y} y={y} width="20" height="2" fill="#b22234" />)}
      <rect width="9" height="8" fill="#3c3b6e" />
      <text x="0.6" y="6.3" fontSize="4.5" fill="#fff">★</text>
    </svg>
  ),
  ja: (
    <svg viewBox="0 0 20 14" className="h-full w-full" aria-hidden>
      <rect width="20" height="14" fill="#fff" />
      <circle cx="10" cy="7" r="3.4" fill="#bc002d" />
    </svg>
  ),
};

/** 小國旗方塊。 */
function Flag({ lang }: { lang: Lang }): JSX.Element {
  return <span className="h-4 w-6 shrink-0 overflow-hidden rounded-sm ring-1 ring-line">{FLAGS[lang]}</span>;
}

/** header 上的語言切換：國旗 + 文字的自訂下拉（原生 select 無法放 SVG 國旗）。 */
export function LangSelect() {
  const { lang: current, setLang: set } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className="flex items-center gap-2 rounded-full border-2 border-line bg-card-soft py-1.5 pr-2.5 pl-2.5 text-sm font-bold text-ink outline-none transition hover:border-pal"
      >
        <Flag lang={current} />
        <span>{LANG_LABELS[current]}</span>
        <FiChevronDown className={`size-4 text-ink-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-1 min-w-full overflow-hidden rounded-xl border-2 border-line bg-card shadow-cute"
        >
          {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
            <button
              key={l}
              role="option"
              aria-selected={current === l}
              onClick={() => {
                set(l);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm transition ${
                current === l ? "bg-pal/15 font-bold text-pal" : "text-ink hover:bg-card-soft"
              }`}
            >
              <Flag lang={l} />
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
