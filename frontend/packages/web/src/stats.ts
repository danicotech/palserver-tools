/**
 * 公開版:已移除外部匿名統計服務(不再連向任何第三方統計伺服器)。
 * 型別與函式保留以相容呼叫端;fetchGlobalStats 一律回傳 null。
 */

export const STATS_URL = "";

export interface GlobalStats {
  downloads: number | null;
  admins: number;
  players: number;
  instancesCreated: number;
  serverStarts: number;
}

/** 公開版不連外部統計服務,永遠回傳 null。 */
export async function fetchGlobalStats(): Promise<GlobalStats | null> {
  return null;
}
