// 對應 palscheduler `/api/pals`（palsave sidecar）回傳的 JSON 結構。
// 來源格式見 palscheduler/tools/palsave/README.md。

export interface Souls {
  hp: number;
  attack: number;
  defense: number;
  craftspeed: number;
}

export interface Pal {
  species: string; // 內部代號，例如 "CowPal" / "BOSS_CowPal"
  name_zh: string; // 繁中名（找不到時退回美化英文代號）
  name_en: string;
  nickname: string;
  paldeck: string; // 圖鑑編號（字串，可能為空）
  elements: string[]; // 屬性（繁中），例如 ["火"]
  level: number;
  exp: number;
  gender: string; // "Male" | "Female" | ""
  rank: number; // 星級 1..5
  souls: Souls; // 靈魂強化 %
  iv_hp: number; // 個體值 0..100
  iv_attack: number;
  iv_defense: number;
  hp: number | null; // 目前/最大 HP（palsave 可能為 null）
  friendship: number;
  stomach: number;
  food_buff: string;
  work: Record<string, number>; // 工作適性，例如 {"牧場":1}
  is_alpha: boolean; // α / BOSS_ 前綴
  is_lucky: boolean;
  active_skills: string[]; // 已裝備主動技能（繁中）
  mastered_skills: string[]; // 已習得主動技能
  passives: string[]; // 被動技能（繁中）
}

export interface StatusPoints {
  hp: number;
  stamina: number;
  attack: number;
  weight: number;
  capture: number;
  workspeed: number;
}

export interface PlayerLocation {
  x: number;
  y: number;
  z: number;
}

export interface Player {
  name: string;
  uid: string; // 存檔 UID，例如 "a9998f41-0000-0000-0000-000000000000"
  level: number;
  exp: number;
  hp: number | null;
  shield_hp: number | null;
  stomach: number;
  hunger: string;
  health: string;
  unused_status_point: number;
  status_points: StatusPoints;
  voice_id: number;
  location: PlayerLocation;
  pal_count: number;
  pals: Pal[];
}

export interface PalsResponse {
  total_pals: number;
  orphan_pals: number;
  players: Player[];
}

// `/api/pals/players` 的摘要（不含每隻帕魯）——與 Player 相同但 pals 省略。
export type PlayerSummary = Omit<Player, "pals"> & { pals?: undefined };
