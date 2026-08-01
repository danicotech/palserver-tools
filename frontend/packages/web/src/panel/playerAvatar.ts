/**
 * 玩家頭像的單一真相來源 —— 玩家卡與地圖標記共用,兩邊才會長一樣。
 *
 * 玩家本身沒有頭像圖,故從他擁有的帕魯挑一隻當代表:以 UID 做穩定雜湊來選,
 * 這樣同一位玩家每次進站都是同一張臉(不會因為抓了新帕魯就換頭像)。
 * 沒有任何帕魯時回 undefined,呼叫端改顯示名字首字。
 */
import type { Player } from "./types";
import { palInfo } from "./paldex";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function playerAvatarUrl(player: Player): string | undefined {
  const pals = player.pals;
  if (!pals?.length) return undefined;
  // 只考慮查得到圖鑑頭像的帕魯,避免挑到沒有圖的變體
  const withIcon = pals.filter((p) => palInfo(p.species).iconUrl);
  if (!withIcon.length) return undefined;
  return palInfo(withIcon[hash(player.uid) % withIcon.length].species).iconUrl;
}

/** 沒有頭像時的備援:名字首字。 */
export function playerInitial(player: Player): string {
  return (player.name || "?").slice(0, 1);
}
