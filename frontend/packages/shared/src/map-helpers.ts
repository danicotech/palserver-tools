// 地圖相關的共用純函式:GUI 即時地圖(packages/web/src/MapTab.tsx)與公開地圖發布端
// (packages/agent/src/public-map.ts)都要用到同一套雜湊/配色演算法,抽到這裡避免各自
// 重算出不一致的結果。
//
// 例外:website/app/map(公開地圖 viewer)不是這個 workspace 的成員(獨立的 Next.js
// 靜態站,不依賴 @palserver/shared),没辦法 import 這個檔案 —— 它改成直接消費 agent
// 算好、放進快照裡的結果(icon 檔名 / warn 布林 / c 色碼),不必自己重算雜湊。

import { PAL_AVATAR_ICONS } from "./pal-avatars.generated.js";

/** 專案裡「依字串挑一個穩定但看起來隨機」的雜湊函式(Java 風格的 31 進位滾動雜湊)。
 *  用於:玩家頭像挑選(pickPalAvatarIcon)、公會配色(guildColorFromId)。 */
export function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

/** 依字串(通常是 guild id)算一個穩定的 HSL 顏色 —— 同一個公會的據點與(GUI 端)成員
 *  永遠同色。演算法與回傳格式原樣照抄 MapTab.tsx 的 guildColor()。 */
export function guildColorFromId(id: string): string {
  return `hsl(${hashSeed(id) % 360} 70% 52%)`;
}

/** 依字串(通常是玩家 userId)挑一個「隨機帕魯頭像」的圖示檔名 —— 跟 MapTab.tsx 的
 *  avatarIconUrl()/PlayerAvatar 同一顆雜湊、同一份挑選清單(PAL_AVATAR_ICONS,由
 *  packages/web/public/game-data/pals.json 生成,見 scripts/gen-pal-avatars.mjs)。
 *  回傳裸檔名(game-data/pals/ 內的檔名),URL 前綴由呼叫端決定 —— GUI 端用
 *  `/game-data/pals/${icon}`,公開地圖 viewer 用 `/map-assets/pal-avatars/${icon}`。 */
export function pickPalAvatarIcon(seed: string): string | null {
  if (!PAL_AVATAR_ICONS.length) return null;
  return PAL_AVATAR_ICONS[hashSeed(seed) % PAL_AVATAR_ICONS.length] ?? null;
}

/** 偷襲警告半徑(地圖座標單位,±1000 span 的那個座標系,主世界/世界樹通用)——
 *  在線玩家與「非自己公會」的據點距離小於這個值,就視為靠近他人據點。
 *  原樣照抄 MapTab.tsx 的 RAID_RADIUS。 */
export const RAID_RADIUS = 70;
