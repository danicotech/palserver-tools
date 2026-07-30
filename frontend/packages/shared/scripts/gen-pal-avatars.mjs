#!/usr/bin/env node
// 產生 src/pal-avatars.generated.ts —— 「隨機帕魯頭像」清單,來源是 packages/web 的
// 帕魯圖鑑(packages/web/public/game-data/pals.json)。挑法必須跟
// packages/web/src/MapTab.tsx 的 avatarIconUrl()/PlayerAvatar 現行邏輯一致:
// 「gameData.pals.filter(p => p.icon)」,依檔案原始順序,只留有 icon 的項目。
//
// 重生指令(pals.json 更新後手動重跑一次,並把這個生成檔的變動一併 commit):
//   node packages/shared/scripts/gen-pal-avatars.mjs
// 或(等效): pnpm --filter @palserver/shared gen:avatars
//
// 為什麼是生成的 .ts 檔而不是執行期讀 JSON:packages/shared 同時被 packages/web(Vite,
// 瀏覽器端)與 packages/agent(Node,tsc build)兩種完全不同的打包環境消費,常數陣列用
// 一般 TS export 最省事、兩邊都能直接用,不必煩惱 JSON import 在不同 bundler 下的路徑/
// resolveJsonModule 設定是否一致。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALS_JSON = path.resolve(__dirname, "../../web/public/game-data/pals.json");
const OUT_FILE = path.resolve(__dirname, "../src/pal-avatars.generated.ts");

const pals = JSON.parse(readFileSync(PALS_JSON, "utf8"));
if (!Array.isArray(pals) || pals.length === 0) {
  console.error(`[gen-pal-avatars] ${PALS_JSON} 讀不到有效的帕魯圖鑑陣列,中止。`);
  process.exit(1);
}

/** @type {string[]} */
const icons = pals.filter((p) => p && typeof p.icon === "string" && p.icon).map((p) => p.icon);
if (icons.length === 0) {
  console.error("[gen-pal-avatars] 圖鑑裡沒有任何帶 icon 的項目,中止(不寫出空清單)。");
  process.exit(1);
}

const body = icons.map((icon) => `  ${JSON.stringify(icon)},`).join("\n");
const out = `// AUTO-GENERATED — 請勿手動編輯。
// 來源:packages/web/public/game-data/pals.json(僅取有 icon 的項目,依檔案原始順序)。
// 重生指令:node packages/shared/scripts/gen-pal-avatars.mjs
//
// 這份清單的順序與內容必須跟 packages/web/src/MapTab.tsx 的
// \`gameData.pals.filter(p => p.icon)\` 選出的清單一致 —— 兩邊用同一個雜湊值對這份清單
// 取模,才能選到同一隻帕魯當頭像(見 pal-avatars.ts 的 pickPalAvatarIcon)。

/** 有頭像可用的帕魯圖示檔名(game-data/pals/ 內的檔名),共 ${icons.length} 項。 */
export const PAL_AVATAR_ICONS: readonly string[] = [
${body}
];
`;

writeFileSync(OUT_FILE, out);
console.log(`[gen-pal-avatars] 寫入 ${icons.length} 個頭像圖示到 ${path.relative(process.cwd(), OUT_FILE)}`);
