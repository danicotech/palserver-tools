import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PanelApp } from "./PanelApp";
import { applyThemeMode, loadThemeMode } from "./theme";
import { initI18n } from "../i18n";
import "../styles.css";
import "./panel.css";

// 掛載前先套用上次選的主題，避免載入瞬間閃色。
applyThemeMode(loadThemeMode());
// 同理:先定語言、開始載字典,首屏就用對的語言。
initI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
