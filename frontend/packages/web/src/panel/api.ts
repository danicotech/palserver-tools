// palscheduler API 用戶端（前後端分離）。
// 連線資訊（後端 base URL + token）存在 localStorage，於連線畫面設定。
// 開發時（且僅限開發時）若未設定 base URL，會退回讀取 public/pals_fixture.json 當離線素材。
// 該檔不進版控（.gitignore），需要時自行從自己的伺服器匯出一份放進 public/。

import type { PalsResponse, Player } from "./types";
import { t } from "../i18n";

const LS_BASE = "palpanel.baseUrl";
const LS_TOKEN = "palpanel.token";

export interface Connection {
  baseUrl: string; // 例如 http://localhost:9000
  token: string;
}

export function loadConnection(): Connection | null {
  const baseUrl = localStorage.getItem(LS_BASE) || "";
  const token = localStorage.getItem(LS_TOKEN) || "";
  if (!baseUrl) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export function saveConnection(conn: Connection) {
  localStorage.setItem(LS_BASE, conn.baseUrl.replace(/\/+$/, ""));
  localStorage.setItem(LS_TOKEN, conn.token);
}

export function clearConnection() {
  localStorage.removeItem(LS_BASE);
  localStorage.removeItem(LS_TOKEN);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 是否未設定「自訂後端」（即使用內建同源代理）。 */
export function isFixtureMode(): boolean {
  return loadConnection() === null;
}

async function request<T>(path: string): Promise<T> {
  const conn = loadConnection();
  // 未設定自訂後端時，base 為空字串＝同源（由面板的 nginx 反向代理到後端，
  // 外部只需開放 8080、免 token）。設定了自訂後端則直接打該位址（需帶 token）。
  const base = conn?.baseUrl ?? "";
  const headers: Record<string, string> = {};
  if (conn?.token) headers["Authorization"] = `Bearer ${conn.token}`;
  try {
    const res = await fetch(base + path, { headers });
    if (res.status === 401) throw new ApiError(401, t("token 無效或未授權"));
    if (res.ok) return (await res.json()) as T;
    // 非 2xx：帕魯資料退回離線素材（下方）
  } catch (e) {
    if (e instanceof ApiError) throw e; // 401 等直接往上丟
    // 網路錯誤（如 dev 模式沒有代理）→ 退回素材
  }
  // 離線素材只在本機開發時使用（import.meta.env.DEV）。
  // 正式建置絕不讀它 —— 否則後端還沒起來時，畫面會顯示素材裡的玩家，
  // 讓人以為是自己伺服器的資料（而且那份素材若含真實玩家，等於外流）。
  const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (isDev && path.startsWith("/api/pals")) {
    const res = await fetch("/pals_fixture.json").catch(() => null);
    if (res?.ok) return (await res.json()) as T;
  }
  throw new ApiError(0, t("無法取得資料（後端未連線）"));
}

/** 探測後端是否可連線（/healthz 免 token）。 */
export async function probe(conn: Connection): Promise<boolean> {
  try {
    const res = await fetch(conn.baseUrl.replace(/\/+$/, "") + "/healthz");
    return res.ok;
  } catch {
    return false;
  }
}

/** 取得全部玩家的完整帕魯資料。 */
export function getAllPals(): Promise<PalsResponse> {
  return request<PalsResponse>("/api/pals");
}

export interface ServerMetrics {
  serverfps: number;
  currentplayernum: number;
  serverframetime: number;
  maxplayernum: number;
  uptime: number; // 秒
  basecampnum: number;
  days: number;
}

export interface ServerStatus {
  mode: string;
  serverRunning: boolean;
  inOpenWindow: boolean;
  currentLabel?: string;
  currentCloseAt?: string;
  nextOpenLabel?: string;
  nextOpenAt?: string;
  serverTimeLocal?: string;
}

/** 取用唯讀端點；任何失敗（未連線/伺服器關閉/未開放代理）回 null。 */
async function tryGet<T>(path: string): Promise<T | null> {
  try {
    const conn = loadConnection();
    const base = conn?.baseUrl ?? "";
    const headers: Record<string, string> = {};
    if (conn?.token) headers["Authorization"] = `Bearer ${conn.token}`;
    const res = await fetch(base + path, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function getMetrics(): Promise<ServerMetrics | null> {
  return tryGet<ServerMetrics>("/api/rest/metrics");
}

export interface RestPlayer {
  name: string;
  userId?: string;
  playerId?: string;
  level?: number;
  ping?: number;
  /** 即時世界座標——與存檔同一個座標系，可直接餵給 savToMap */
  location_x?: number;
  location_y?: number;
}

/** 官方 REST 的在線玩家原始列（含即時座標）；未連線／未開放代理時回空陣列。 */
export async function getRestPlayers(): Promise<RestPlayer[]> {
  const r = await tryGet<{ players?: RestPlayer[] } | RestPlayer[] | { ok?: boolean; players?: RestPlayer[] }>(
    "/api/rest/players",
  );
  if (!r) return [];
  return Array.isArray(r) ? r : ((r as { players?: RestPlayer[] }).players ?? []);
}

export interface LivePosition {
  x: number;
  y: number;
  level?: number;
  ping?: number;
}

/** 玩家名（小寫）→ 即時座標。存檔裡的位置是「最後傳送點」且只在存檔寫入時更新，
 *  所以在線玩家一律以這份即時座標為準。 */
export function livePositionsOf(players: RestPlayer[]): Map<string, LivePosition> {
  const m = new Map<string, LivePosition>();
  for (const p of players) {
    const name = (p.name ?? "").trim().toLowerCase();
    if (!name || typeof p.location_x !== "number" || typeof p.location_y !== "number") continue;
    m.set(name, { x: p.location_x, y: p.location_y, level: p.level, ping: p.ping });
  }
  return m;
}

/** 取得目前在線玩家（官方 REST）。回傳玩家名稱陣列（小寫）供比對；失敗回空陣列。 */
export async function getOnlinePlayers(): Promise<string[]> {
  return (await getRestPlayers()).map((p) => (p.name ?? "").trim().toLowerCase()).filter(Boolean);
}

export function getStatus(): Promise<ServerStatus | null> {
  return tryGet<ServerStatus>("/api/status");
}

export interface PresencePlayer {
  userId: string;
  name: string;
  onlineSeconds: number;
  sessions: number;
  avgSessionSeconds: number;
  currentSessionSeconds: number; // 本次上線時長（僅在線時 >0）
  hourSecs: number[]; // 24：各時段線上秒數（0-23 時）
  weekSecs: number[]; // 7：各星期線上秒數（0=週日..6=週六）
  firstSeen: number; // unix 秒
  lastSeen: number;
  online: boolean;
}

export interface PresenceData {
  trackingSince: number; // unix 秒
  pollSeconds: number;
  players: PresencePlayer[];
}

/** 取得玩家上線時數/次數統計（後端自啟用起累計）。失敗回 null。 */
export function getPresence(): Promise<PresenceData | null> {
  return tryGet<PresenceData>("/api/presence");
}

// ---- 玩家頭像共用名冊（公開端點，免 token）----

export interface RosterEntry {
  name: string;
  palId: string;
  updatedAt: number; // unix 秒
}

/** 取得全部玩家頭像名冊（所有人共用）。失敗回 null。 */
export function getRoster(): Promise<RosterEntry[] | null> {
  return tryGet<RosterEntry[]>("/api/roster");
}

/** 設定自己的頭像（玩家名 + 帕魯代號）。成功回 true。 */
export async function setRoster(name: string, palId: string): Promise<boolean> {
  try {
    const conn = loadConnection();
    const base = conn?.baseUrl ?? "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (conn?.token) headers["Authorization"] = `Bearer ${conn.token}`;
    const res = await fetch(base + "/api/roster", {
      method: "POST",
      headers,
      body: JSON.stringify({ name, palId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 查詢單一玩家（名稱或 UID，部分比對）的完整帕魯。 */
export async function getPlayer(query: string): Promise<Player[]> {
  const all = await getAllPals();
  const q = query.trim().toLowerCase();
  if (!q) return all.players;
  return all.players.filter(
    (p) => p.name.toLowerCase().includes(q) || p.uid.toLowerCase().includes(q),
  );
}
