import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSeed, pickPalAvatarIcon } from "./map-helpers.js";
import { PAL_AVATAR_ICONS } from "./pal-avatars.generated.js";

// 這個檔案證明「packages/web/src/MapTab.tsx 的 avatarIconUrl() 改用 @palserver/shared 的
// hashSeed() 之後,對同一組 userId 選出的頭像跟改之前一模一樣」——不是靠讀 MapTab.tsx
// 原始碼比對(那樣測試會跟著程式碼一起變、失去意義),而是:
//   1) 獨立重新實作「改之前」那段內聯雜湊迴圈(originalHashLoop,逐字照抄舊版邏輯的複本),
//      證明它與 hashSeed() 在大量樣本上輸出完全相同 —— 這代表「把迴圈抽成 hashSeed()」
//      這個重構本身沒有改變任何一個位元的計算結果。
//   2) 證明 PAL_AVATAR_ICONS(shared 生成清單)與「即時讀 pals.json、用 MapTab 同款
//      filter(p => p.icon) 篩出來的清單」內容與順序完全一致 —— 這代表 MapTab 選頭像時
//      用的候選清單(gameData.pals,bundled 版等同 pals.json)跟 shared 這份生成清單
//      是同一份資料。
// 兩者合起來:對任何 userId,「MapTab 改之前」與「MapTab 改之後(呼叫 hashSeed)」、以及
// 「agent 公開地圖用 pickPalAvatarIcon」三條路徑,選出的帕魯頭像保證一致。

/** MapTab.tsx 重構前 avatarIconUrl() 內聯的雜湊迴圈,逐字複本(不 import 共用版本)。 */
function originalHashLoop(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

const SAMPLE_SEEDS = [
  "steam_76561198000000001",
  "steam_76561198000000002",
  "xbl_1234567890",
  "a",
  "",
  "玩家甲",
  "player-with-a-very-long-user-id-string-1234567890",
  "0000000000000000",
  "UPPERCASE_SEED",
  "🎮emoji-seed",
];

test("hashSeed 與重構前的內聯雜湊迴圈,大量樣本輸出逐位元相同", () => {
  for (const seed of SAMPLE_SEEDS) {
    assert.equal(hashSeed(seed), originalHashLoop(seed), `seed=${JSON.stringify(seed)}`);
  }
  // 再跑一批隨機字串,不只手選樣本。
  for (let i = 0; i < 500; i++) {
    const len = Math.floor(Math.random() * 24);
    let seed = "";
    for (let j = 0; j < len; j++) seed += String.fromCharCode(32 + Math.floor(Math.random() * 95));
    assert.equal(hashSeed(seed), originalHashLoop(seed), `random seed=${JSON.stringify(seed)}`);
  }
});

test("PAL_AVATAR_ICONS 與即時讀 pals.json + MapTab 同款 filter 的結果完全一致(內容與順序)", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const palsJsonPath = path.resolve(__dirname, "../../web/public/game-data/pals.json");
  const pals = JSON.parse(fs.readFileSync(palsJsonPath, "utf8")) as { icon?: string }[];
  // 與 MapTab.tsx 的 `gameData.pals.filter((p) => p.icon)` 逐字同款 filter。
  const liveIcons = pals.filter((p) => p.icon).map((p) => p.icon as string);

  assert.ok(liveIcons.length > 0, "pals.json 應該至少有一個帶 icon 的項目");
  assert.deepEqual([...PAL_AVATAR_ICONS], liveIcons);
});

test("等價重構的最終證明:對同一組 userId,『MapTab 原演算法複本』與『共用 helper』選出同一個頭像檔名", () => {
  // originalMapTabPick = 重構前 avatarIconUrl() 的完整邏輯複本(讀 pals.json 當 gameData.pals)。
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const palsJsonPath = path.resolve(__dirname, "../../web/public/game-data/pals.json");
  const pals = JSON.parse(fs.readFileSync(palsJsonPath, "utf8")) as { icon?: string }[];
  const withIcons = pals.filter((p) => p.icon);

  function originalMapTabPick(seed: string): string | null {
    if (!withIcons.length) return null;
    const hash = originalHashLoop(seed);
    const pal = withIcons[hash % withIcons.length];
    return pal.icon ?? null;
  }

  for (const seed of SAMPLE_SEEDS) {
    assert.equal(pickPalAvatarIcon(seed), originalMapTabPick(seed), `seed=${JSON.stringify(seed)}`);
  }
  for (let i = 0; i < 500; i++) {
    const seed = `player-${i}-${Math.random().toString(36).slice(2)}`;
    assert.equal(pickPalAvatarIcon(seed), originalMapTabPick(seed), `seed=${JSON.stringify(seed)}`);
  }
});
