// 共用資料層：抓一次全服帕魯資料並快取，提供聚合/查詢工具。
import { useEffect, useRef, useState } from "react";
import type { Pal, Player, Guild, PalsResponse } from "./types";
import { getAllPals } from "./api";
import { loadPaldex, palInfo, isExcludedSpecies } from "./paldex";

// 一隻帕魯 + 其擁有者的組合，供跨玩家查詢使用。
export interface OwnedPal {
  pal: Pal;
  owner: Player;
}

// 一個物種的彙整。key 用 name_en（BOSS_/α 變體會回歸基礎種），顯示用 name_zh。
export interface SpeciesGroup {
  key: string;
  species: string; // 代表個體的內部代號，供顯示時依語言即時挑名
  name_zh: string;
  name_en: string;
  paldeck: string;
  elements: string[];
  total: number; // 全服總數
  owners: number; // 擁有的玩家數
  perPlayer: { player: Player; count: number }[]; // 各玩家抓幾隻（多→少）
  specimens: OwnedPal[]; // 全部個體
}

export interface Dataset {
  players: Player[];
  allPals: OwnedPal[];
  species: SpeciesGroup[]; // 依全服總數排序（多→少）
  totalPals: number;
  guilds: Guild[]; // 公會/據點(後端慢路徑快取,未就緒時為空)
}

/** 物種鍵：BOSS_/α 變體透過 name_en 回歸基礎種。 */
export function speciesKey(pal: Pal): string {
  return pal.name_en || pal.species;
}

/** 帕魯戰力分數（用於「最佳個體」排序，非遊戲官方數值）。 */
export function palScore(pal: Pal): number {
  const iv = pal.iv_hp + pal.iv_attack + pal.iv_defense;
  const soul = pal.souls.hp + pal.souls.attack + pal.souls.defense + pal.souls.craftspeed;
  return (
    pal.level * 10 +
    iv +
    soul +
    pal.rank * 20 +
    (pal.is_alpha ? 50 : 0) +
    (pal.is_lucky ? 30 : 0)
  );
}

export function ivSum(pal: Pal): number {
  return pal.iv_hp + pal.iv_attack + pal.iv_defense;
}

export function isPerfectIv(pal: Pal): boolean {
  return pal.iv_hp === 100 && pal.iv_attack === 100 && pal.iv_defense === 100;
}

function buildDataset(resp: PalsResponse): Dataset {
  // 先把「被排除的錯誤物種」從每位玩家的帕魯中濾掉,並同步修正帕魯總數,
  // 讓後續所有統計/排行/查詢/圖鑑一致地看不到這些帕魯。
  const players = resp.players.map((p) => {
    const pals = p.pals.filter((pal) => !isExcludedSpecies(pal.species) && !isExcludedSpecies(pal.name_en));
    return pals.length === p.pals.length ? p : { ...p, pals, pal_count: pals.length };
  });
  const allPals: OwnedPal[] = [];
  const groups = new Map<string, SpeciesGroup>();
  const perPlayerCount = new Map<string, Map<string, number>>(); // key -> playerUid -> count

  for (const owner of players) {
    for (const pal of owner.pals) {
      allPals.push({ pal, owner });
      const key = speciesKey(pal);
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          species: pal.species,
          name_zh: palInfo(pal.species).zh || pal.name_zh, // 圖鑑名（後備；顯示改用 palName(species)）
          name_en: pal.name_en,
          paldeck: pal.paldeck,
          elements: pal.elements,
          total: 0,
          owners: 0,
          perPlayer: [],
          specimens: [],
        };
        groups.set(key, g);
        perPlayerCount.set(key, new Map());
      }
      // 有圖鑑資料/屬性的實例優先當代表（避免顯示未解析的變體名）。
      if (!g.paldeck && pal.paldeck) {
        g.paldeck = pal.paldeck;
        g.species = pal.species;
        g.name_zh = palInfo(pal.species).zh || pal.name_zh;
        g.name_en = pal.name_en;
        g.elements = pal.elements;
      }
      g.total++;
      g.specimens.push({ pal, owner });
      const pc = perPlayerCount.get(key)!;
      pc.set(owner.uid, (pc.get(owner.uid) ?? 0) + 1);
    }
  }

  const byUid = new Map(players.map((p) => [p.uid, p]));
  for (const [key, g] of groups) {
    const pc = perPlayerCount.get(key)!;
    g.owners = pc.size;
    g.perPlayer = [...pc.entries()]
      .map(([uid, count]) => ({ player: byUid.get(uid)!, count }))
      .sort((a, b) => b.count - a.count);
    g.specimens.sort((a, b) => palScore(b.pal) - palScore(a.pal));
  }

  const species = [...groups.values()].sort((a, b) => b.total - a.total);
  return { players, allPals, species, totalPals: allPals.length, guilds: resp.guilds ?? [] };
}

// 模組層快取：多個分頁共用同一次抓取。
let cache: Promise<Dataset> | null = null;

// ── 本地存檔模式 ─────────────────────────────────────────────────
// 單機玩家把自己的 Level.sav 拖進網頁後,解析結果就放在這裡,
// 蓋過「跟伺服器要的資料」。所有分頁吃的都是同一個 Dataset,
// 因此不必改任何分頁就能直接看自己的存檔。
//
// 只存在記憶體 + sessionStorage:關掉分頁就消失,不會留在硬碟上,
// 也不會送去伺服器儲存(解析是即時的,伺服器端不落地)。
const SS_KEY = "palpanel.localSave";

let localResp: PalsResponse | null = null;
let localDataset: Promise<Dataset> | null = null;
const localListeners = new Set<() => void>();

/** 目前是否在看「上傳的存檔」而不是伺服器資料。 */
export function isLocalMode(): boolean {
  return localResp !== null;
}

/** 訂閱本地/伺服器模式的切換(給 UI 重新渲染用)。 */
export function onLocalModeChange(fn: () => void): () => void {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
}

function notifyLocal() {
  for (const fn of localListeners) fn();
}

/** 切換成「看上傳的存檔」。傳 null 則切回伺服器資料。 */
export function setLocalSave(resp: PalsResponse | null) {
  localResp = resp;
  localDataset = null;
  if (resp) {
    // sessionStorage 讓「重新整理」不會白白丟掉剛解析好的結果。
    // 大存檔的 JSON 可能好幾十 MB 而配額只有幾 MB —— 存不下就算了,
    // 記憶體那份仍然有效,只是重新整理後要重傳。
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(resp));
    } catch {
      /* 超過配額:略過持久化,不影響目前這一份 */
    }
  } else {
    sessionStorage.removeItem(SS_KEY);
  }
  notifyLocal();
}

/** 頁面載入時把 sessionStorage 裡的上一份接回來(重新整理不必重傳)。 */
export function restoreLocalSave(): boolean {
  if (localResp) return true;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return false;
    localResp = JSON.parse(raw) as PalsResponse;
    notifyLocal();
    return true;
  } catch {
    sessionStorage.removeItem(SS_KEY);
    return false;
  }
}

export function loadDataset(force = false): Promise<Dataset> {
  // 本地模式優先:有上傳的存檔就完全不去打伺服器
  if (localResp) {
    if (force) localDataset = null;
    const resp = localResp;
    localDataset ??= loadPaldex().then(() => buildDataset(resp));
    return localDataset;
  }
  if (force) cache = null;
  if (!cache) {
    // 同時載入帕魯資料與圖鑑對照（頭像/正確繁中名），確保建表時對照已就緒。
    cache = Promise.all([getAllPals(), loadPaldex()]).then(([resp]) => buildDataset(resp));
  }
  return cache;
}

export interface DatasetState {
  data: Dataset | null;
  /** 首次載入(畫面上還沒有任何資料可顯示) */
  loading: boolean;
  /** 背景更新中:舊資料仍在畫面上,只是正在抓新的 */
  refreshing: boolean;
  error: string | null;
  reload: () => void;
}

/** React hook：載入全服資料集（共用快取）。 */
export function useDataset(): DatasetState {
  const [data, setData] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // 用 ref 讀「目前有沒有資料」,才不會讓 effect 依賴 data 而重跑
  const hasDataRef = useRef(false);
  hasDataRef.current = data !== null;

  useEffect(() => {
    let alive = true;
    setBusy(true);
    // 背景更新時保留舊錯誤狀態不清除畫面;只有首次載入才重置
    if (!hasDataRef.current) setError(null);
    loadDataset(nonce > 0)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        // 已經有資料就不要把畫面換成錯誤頁,維持舊資料即可
        if (alive && !hasDataRef.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return {
    data,
    loading: busy && data === null,
    refreshing: busy && data !== null,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
