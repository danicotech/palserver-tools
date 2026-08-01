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

export function loadDataset(force = false): Promise<Dataset> {
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
