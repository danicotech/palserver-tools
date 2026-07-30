// 帕魯圖鑑對照：用內建 game-data 補正確名稱（繁中/簡中/英/日）與頭像。
// pals.json：{ id, name(en), icon, zh, zh-CN, ja }；humans.json 同（人類 NPC）。
// 名稱一律存四語，顯示時依目前介面語言即時挑選（palInfo/palName），故切語言即時生效。
import { getLang } from "../i18n";

// 各語言名稱對照（key 對齊 i18n 的 Lang：zh / zh-CN / en / ja）。
type Names = { zh: string; "zh-CN"?: string; en?: string; ja?: string };

/** 依目前介面語言挑名稱；缺該語言時退回 繁中 → 英文。 */
function pickName(n: Names | undefined): string {
  if (!n) return "";
  const lang = getLang();
  return n[lang] || n.zh || n.en || "";
}

interface DexEntry {
  names: Names;
  iconUrl: string;
  isPal: boolean; // 真帕魯（算入圖鑑）；人類 NPC 為 false
}

export interface BossEntry {
  key: string; // 由 icon 反推的物種鍵（小寫），供與已捕捉 α 物種比對
  names: Names;
  iconUrl: string;
  lv: number;
  kind: string;
}

export interface PalRosterEntry {
  key: string; // pals.json id 小寫
  names: Names;
  iconUrl: string;
}

let DEX: Map<string, DexEntry> | null = null;
let PAL_TOTAL = 0; // 真帕魯物種總數（圖鑑分母）
let PAL_ROSTER: PalRosterEntry[] = []; // 全帕魯圖鑑名單（依 pals.json 順序）
let BOSSES: BossEntry[] = [];
let TRAIT: Map<string, Names> | null = null; // 詞條/技能名（任一語言 → 四語對照）

// 少數對不到的手動補繁中名。
const MANUAL: Record<string, string> = {
  police_thunderdog: "警電犬",
  male_ninjaelite: "菁英忍者",
  female_people: "女性居民",
  male_people: "男性居民",
  negotiator: "交涉者",
};

function hasCJK(s: string): boolean {
  return /[㐀-鿿]/.test(s);
}

// 由頭像檔名反推物種鍵："T_GrassGolem_Dark_icon_normal.webp" → "grassgolem_dark"
function iconToKey(icon: string): string {
  return icon.replace(/^T_/, "").replace(/_icon_normal\.(png|webp)$/i, "").toLowerCase();
}

/** 正規化內部代號：去掉 BOSS_/PREDATOR_… 前綴（不分大小寫）與 _otomo 後綴。 */
function normalize(species: string): string {
  return species
    .replace(/^(BOSS_|PREDATOR_|SUMMON_|RAID_|GYM_)/i, "")
    .replace(/_otomo$/i, "")
    .toLowerCase();
}

/** 錯誤/不該出現在系統的物種（例如塔王變體），一律從圖鑑與所有統計排除。 */
export const EXCLUDED_SPECIES = new Set(["grasspanda_electric_tower", "lazydragon_electric_tower"]);

/** 此代號是否為被排除的錯誤物種（正規化後比對）。 */
export function isExcludedSpecies(species: string): boolean {
  return !!species && EXCLUDED_SPECIES.has(normalize(species));
}

/** 載入圖鑑對照（pals + humans）+ 首領名單（結果快取）。 */
export async function loadPaldex(): Promise<void> {
  if (DEX) return;
  DEX = new Map();
  // 真帕魯（四語名稱皆存）
  try {
    const res = await fetch("/game-data/pals.json");
    if (res.ok) {
      const arr = (await res.json()) as Array<{ id: string; name: string; icon: string; zh?: string; "zh-CN"?: string; ja?: string }>;
      for (const p of arr) {
        const key = p.id.toLowerCase();
        if (EXCLUDED_SPECIES.has(key)) continue; // 排除錯誤物種：不進圖鑑對照/名單/分母
        const iconUrl = `/game-data/pals/${p.icon}`;
        const names: Names = { zh: p.zh || p.name, "zh-CN": p["zh-CN"], en: p.name, ja: p.ja };
        DEX.set(key, { names, iconUrl, isPal: true });
        PAL_ROSTER.push({ key, names, iconUrl });
      }
      PAL_TOTAL = PAL_ROSTER.length; // 圖鑑分母＝實際收錄數（已扣除排除物種）
    }
  } catch {
    /* ignore */
  }
  // 人類 NPC（四語名稱；humans.json 的簡中鍵為 zhCN）
  try {
    const res = await fetch("/game-data/humans.json");
    if (res.ok) {
      const arr = (await res.json()) as Array<{ id: string; name: string; icon: string; zh?: string; zhCN?: string; ja?: string }>;
      for (const p of arr) {
        const key = p.id.toLowerCase();
        if (!DEX.has(key))
          DEX.set(key, { names: { zh: p.zh || p.name, "zh-CN": p.zhCN, en: p.name, ja: p.ja }, iconUrl: `/game-data/humans/${p.icon}`, isPal: false });
      }
    }
  } catch {
    /* ignore */
  }
  await loadTraitNames();
  // 首領名單
  try {
    const res = await fetch("/game-data/bosses.json");
    if (res.ok) {
      const arr = (await res.json()) as Array<{
        name: { en: string; zh?: string; "zh-CN"?: string; ja?: string };
        icon: string;
        lv: number;
        kind: string;
      }>;
      BOSSES = arr.map((b) => {
        const key = iconToKey(b.icon);
        // 優先用 pals.json 的四語名（bosses.json 的 zh-CN 為簡體、其餘常未在地化）；
        // 對不到 pal 時退回 bosses.json 自帶名稱。
        const fromPal = DEX!.get(key)?.names;
        const zh = b.name.zh && hasCJK(b.name.zh) ? b.name.zh : b.name["zh-CN"] && hasCJK(b.name["zh-CN"]!) ? b.name["zh-CN"] : b.name.en;
        const names: Names = fromPal ?? { zh: zh || b.name.en, "zh-CN": b.name["zh-CN"], en: b.name.en, ja: b.name.ja && hasCJK(b.name.ja) ? b.name.ja : undefined };
        return { key, names, iconUrl: `/game-data/pals/${b.icon}`, lv: b.lv, kind: b.kind };
      });
    }
  } catch {
    BOSSES = [];
  }
}

export function getBossRoster(): BossEntry[] {
  return BOSSES;
}

export function bossKey(species: string): string {
  return normalize(species);
}

/** 對外的「依目前語言挑名稱」工具（供 roster / boss 等已存四語的物件顯示用）。 */
export function localizedName(n: { zh: string; "zh-CN"?: string; en?: string; ja?: string }): string {
  return pickName(n);
}

/** 依內部代號取得 { 顯示名（當前語言）, 頭像 URL }；pals→humans→手動。
 *  注意：回傳欄位沿用 `zh` 之名，但內容已依介面語言在地化。 */
export function palInfo(species: string): { zh?: string; iconUrl?: string } {
  if (!DEX) return {};
  const k = normalize(species);
  const hit = DEX.get(k);
  if (hit) return { zh: pickName(hit.names), iconUrl: hit.iconUrl };
  if (MANUAL[k]) return { zh: MANUAL[k] };
  return {};
}

/** 依內部代號取得當前語言的帕魯顯示名（查無回空字串）。 */
export function palName(species: string): string {
  return palInfo(species).zh ?? "";
}

// ---- 詞條 / 技能 / 工作適性 名稱在地化 ----
// 存檔解析回傳的技能/詞條為「繁中名」；此處建反查表（任一語言 → 四語），
// 顯示時依介面語言換名，但比對/篩選仍用後端原始（繁中）字串。

async function loadTraitNames(): Promise<void> {
  if (TRAIT) return;
  TRAIT = new Map();
  const add = (n: Names) => {
    for (const v of [n.zh, n["zh-CN"], n.en, n.ja]) if (v) TRAIT!.set(v, n);
  };
  for (const url of ["/game-data/passives.json", "/game-data/activeSkills.json"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const arr = (await res.json()) as Array<{ name: string; zh?: string; "zh-CN"?: string; ja?: string }>;
      for (const s of arr) {
        if (!s.zh && !s.name) continue;
        add({ zh: s.zh || s.name, "zh-CN": s["zh-CN"], en: s.name, ja: s.ja });
      }
    } catch {
      /* ignore */
    }
  }
}

/** 詞條/技能名 → 當前語言；查無（或無該語言）時原樣回傳。 */
export function localizeTrait(name: string): string {
  const hit = TRAIT?.get(name);
  return hit ? pickName(hit) : name;
}

// 工作適性 13 種（繁中 → 四語官方名）。存檔的 work key 為繁中。
const WORK_NAMES: Record<string, Names> = {
  點火: { zh: "點火", "zh-CN": "点火", en: "Kindling", ja: "火起こし" },
  灌溉: { zh: "灌溉", "zh-CN": "灌溉", en: "Watering", ja: "水やり" },
  播種: { zh: "播種", "zh-CN": "播种", en: "Planting", ja: "種まき" },
  發電: { zh: "發電", "zh-CN": "发电", en: "Generating Electricity", ja: "発電" },
  手工: { zh: "手工", "zh-CN": "手工", en: "Handiwork", ja: "手作業" },
  採集: { zh: "採集", "zh-CN": "采集", en: "Gathering", ja: "採取" },
  伐木: { zh: "伐木", "zh-CN": "伐木", en: "Lumbering", ja: "伐採" },
  採礦: { zh: "採礦", "zh-CN": "采矿", en: "Mining", ja: "採掘" },
  原油提取: { zh: "原油提取", "zh-CN": "原油提取", en: "Oil Extraction", ja: "採油" },
  製藥: { zh: "製藥", "zh-CN": "制药", en: "Medicine Production", ja: "薬品製造" },
  製冷: { zh: "製冷", "zh-CN": "制冷", en: "Cooling", ja: "冷却" },
  搬運: { zh: "搬運", "zh-CN": "搬运", en: "Transporting", ja: "運搬" },
  牧場: { zh: "牧場", "zh-CN": "牧场", en: "Farming", ja: "牧場" },
};

/** 工作適性名 → 當前語言；查無原樣回傳。 */
export function localizeWork(name: string): string {
  return WORK_NAMES[name] ? pickName(WORK_NAMES[name]) : name;
}

/** 若此代號為「真帕魯」，回傳其圖鑑鍵（pals.json id）；否則 null（人類 NPC 不算圖鑑）。 */
export function paldexId(species: string): string | null {
  if (!DEX) return null;
  const k = normalize(species);
  const hit = DEX.get(k);
  return hit && hit.isPal ? k : null;
}

/** 圖鑑物種總數（達成率分母）。 */
export function paldexTotal(): number {
  return PAL_TOTAL;
}

/** 全帕魯圖鑑名單（依 pals.json 順序）。 */
export function getPalRoster(): PalRosterEntry[] {
  return PAL_ROSTER;
}

/** 依 seed（如玩家 uid）取一個固定的隨機帕魯頭像 URL（玩家沒有頭像時用）。 */
export function randomPalAvatar(seed: string): string {
  if (!PAL_ROSTER.length) return "";
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PAL_ROSTER[(h >>> 0) % PAL_ROSTER.length].iconUrl;
}
