/**
 * 玩家頭像的單一真相來源 —— 玩家卡、地圖標記、總覽/排行榜/上線分析共用同一條規則:
 *
 *   1. 他在右上角「設定頭像」選的那隻(共用名冊,設定後全站即時連動)
 *   2. 沒設定 → 用 UID 做穩定雜湊挑一隻固定的帕魯(randomPalAvatar,與各榜單同一支)
 *
 * 玩家卡與地圖原本是「從他擁有的帕魯挑一隻」,規則和總覽那邊不同,又沒讀名冊,
 * 所以設定過頭像也不會變 —— 統一到這裡之後三邊才會一致。
 */
import { useCallback } from "react";
import { useRoster } from "./rosterCtx";
import { randomPalAvatar } from "./paldex";

/** 沒設定頭像時的固定備援(與總覽/排行榜同一條規則)。 */
export function fallbackAvatarUrl(uid: string, name?: string): string {
  return randomPalAvatar(uid || name || "");
}

/** 取得「這位玩家該顯示哪張頭像」;名冊更新會換一個新函式,呼叫端記得放進 deps。 */
export function usePlayerAvatar(): (p: { uid: string; name: string }) => string | undefined {
  const { avatarUrlFor } = useRoster();
  return useCallback(
    (p: { uid: string; name: string }) => avatarUrlFor(p.name) || fallbackAvatarUrl(p.uid, p.name) || undefined,
    [avatarUrlFor],
  );
}

/** 連備援圖都拿不到時:顯示名字首字。 */
export function playerInitial(player: { name: string }): string {
  return (player.name || "?").slice(0, 1);
}
