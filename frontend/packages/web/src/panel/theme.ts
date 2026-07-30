// 精簡主題模組（沿用 palserver-gui 設計）：pal 家族的 auto/light/dark。
// data-theme 掛在 <html>，styles.css 據此覆蓋色票。
import { useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";
const KEY = "palserver.theme";

export function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
    return "auto";
  } catch {
    return "auto";
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
}

let currentMode: ThemeMode = loadThemeMode();
const listeners = new Set<(m: ThemeMode) => void>();

export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  applyThemeMode(mode);
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* 無痕模式 */
  }
  listeners.forEach((l) => l(mode));
}

export function useThemeMode(): ThemeMode {
  const [m, setM] = useState<ThemeMode>(() => currentMode);
  useEffect(() => {
    listeners.add(setM);
    setM(currentMode);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

/** 目前實際是否為深色（auto 時看系統）。 */
export function isDarkNow(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === "auto") return systemDark;
  return mode === "dark";
}
