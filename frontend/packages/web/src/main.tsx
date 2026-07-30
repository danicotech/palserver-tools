import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyThemeMode, loadThemeMode } from "./theme";
import { initI18n } from "./i18n";
import "./styles.css";

// 在 React 掛載前先套用上次選的深淺色,避免載入瞬間閃過另一個主題。
applyThemeMode(loadThemeMode());
// 同理:先定語言、開始載字典,首屏就用對的語言。
initI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
