/**
 * 變異(突變)配種機率模型 —— 與 breedingTable(直系配種查表)互補。
 *
 * 資料來源與驗算:
 *  - CombiRank(繁殖值):paldb.cc 的 Combi 表,與 tylercamp/palcalc 的 BreedingPower 逐項一致
 *    (抽驗 60 隻全同,例:海皇鯨 160、墨羅娜 280、磐甲龍 30)。
 *  - 可突變名單:paldb.cc Combi 表的 Mutation 欄位,共 143/299 隻。只能自體繁殖的帕魯
 *    (傑諾多蘭、貝菈露潔、波魯傑克斯…)不在名單內,與社群「無法突變出來」的結論一致。
 *  - 窗口公式:對 paldb 兩張完整突變表(墨羅娜 340 組 + 阿努比斯 802 組,共 1,142 筆)
 *    做最小平方擬合得到 —— 窗口「寬度」只由較強的親代決定,「位置」由較弱的親代帶動:
 *      L = 0.1·min + 0.4·max   H = 0.2·min + 0.4·max   (見 mutationWindow)
 *    自交時退化為 [0.5r, 0.6r]。
 *  - 單一結果機率:區間內每個 CombiRank 整數值對映到「最接近的可突變帕魯」,
 *    某帕魯的機率 = 它涵蓋的值數 / 區間總值數(條件於「這顆蛋是突變蛋」)。
 *  - 觸發率:官方 1.0 更新說明 —— 蘑菇蛋糕 1%、蔬菜蛋糕 2%(一次兩顆蛋)、豪華蔬菜蛋糕 3%。
 *  - 產蛋間隔:巴哈碼表實測 —— 配種牧場 5 分/顆(滿星梁葉龍或寶寶保母 3 分 20 秒),
 *    古代文明配種牧場 11 秒/顆(有加成 7 秒);梁葉龍與寶寶保母不可疊加,取高者。
 *
 * 全量回歸:對 paldb 全部 143 個可突變目標共 495,068 筆組合驗證 —— 93.5% 與 paldb 完全相同、
 * 99.2% 誤差 <1 個百分點、100% <3 個百分點。遊戲未公開內部表,故顯示時仍標示為「估算」。
 */

export interface MutationPal {
  id: string;
  zh: string;
  /** CombiRank(繁殖值);數字越小代表越高階 */
  rank: number;
  /** 1 = 可由突變產出 */
  mut: number;
}

export interface MutationData {
  source: string;
  note: string;
  pals: MutationPal[];
}

export interface MutationIndex {
  byId: Map<string, MutationPal>;
  /** 可突變帕魯,依 rank 由小到大(高階在前) */
  eligible: MutationPal[];
}

/**
 * 蛋糕與突變率(官方 1.0 更新說明)。蔬菜蛋糕一次產兩顆蛋,官方標示「視同 2%」,
 * 故 rate 記 2% 且 eggsPerCycle = 2(算期望時間時兩者不重複計算)。
 */
export const CAKES = {
  mushroom: { rate: 0.01, eggsPerCycle: 1, label: "蘑菇蛋糕", note: "潛力值較易上升" },
  vegetable: { rate: 0.02, eggsPerCycle: 2, label: "蔬菜蛋糕", note: "一次產兩顆蛋" },
  deluxe: { rate: 0.03, eggsPerCycle: 1, label: "豪華蔬菜蛋糕", note: "最易突變,潛力值也易上升" },
} as const;
export type CakeKind = keyof typeof CAKES;
/** 舊介面相容:只取觸發率。 */
export const MUTATION_RATE: Record<CakeKind, number> = {
  mushroom: CAKES.mushroom.rate,
  vegetable: CAKES.vegetable.rate,
  deluxe: CAKES.deluxe.rate,
};

/**
 * 產蛋間隔(秒)—— 巴哈碼表實測值,用來把「期望顆數」換算成實際時間。
 * 寶寶保母與梁葉龍效果不可疊加(取高者),故只分「有無梁葉龍(滿星)/保母」兩檔。
 */
export const FARMS = {
  normal: { label: "配種牧場", base: 300, boosted: 200 },
  ancient: { label: "古代文明配種牧場", base: 11, boosted: 7 },
} as const;
export type FarmKind = keyof typeof FARMS;

/** 突變帕魯的固定加成(官方更新說明)。 */
export const MUTATION_PERKS = [
  "潛力值 90–100",
  "首領帕魯",
  "2 星濃縮",
  "2–4 個彩虹被動技能",
  "高等級技能",
  "工作適應性 +2",
] as const;

/** 突變專屬的彩虹被動技能(也可用耗材植入體在手術台取得)。 */
export const MUTATION_PASSIVES = ["不死之身", "特殊體質", "寶寶保母", "重裝甲", "凌空微步"] as const;

export function buildMutationIndex(data: MutationData): MutationIndex {
  const byId = new Map(data.pals.map((p) => [p.id, p]));
  const eligible = data.pals.filter((p) => p.mut === 1).sort((a, b) => a.rank - b.rank);
  return { byId, eligible };
}

/**
 * 突變候選的 CombiRank 區間。係數由 paldb 的 495,068 筆實測組合擬合:
 * 窗口寬度只由「較強的親代」(min rank)決定,位置由「較弱的親代」帶動。
 *   L = 0.1·min + 0.4·max   (開區間下界,取 floor 後 +1)
 *   H = 0.2·min + 0.4·max   (取 floor)
 * 自交時退化為 [0.5r, 0.6r],正好對上 paldb 的自交百分比。
 */
export const WINDOW_COEF = { lMin: 0.1, lMax: 0.4, hMin: 0.2, hMax: 0.4 } as const;

export function mutationWindow(rankA: number, rankB: number): { lo: number; hi: number } {
  const min = Math.min(rankA, rankB);
  const max = Math.max(rankA, rankB);
  return {
    lo: WINDOW_COEF.lMin * min + WINDOW_COEF.lMax * max,
    hi: WINDOW_COEF.hMin * min + WINDOW_COEF.hMax * max,
  };
}

/** 一對父母的突變結果分佈(已依機率由高到低排序;機率和為 1,條件於「有發生突變」)。 */
export interface MutationOutcome {
  pal: MutationPal;
  /** 條件機率:已知這顆蛋是突變蛋時,是這隻的機率 */
  chance: number;
}

/**
 * 區間內每個整數 CombiRank 對映到最接近的可突變帕魯,統計佔比。
 * 平手(值剛好落在兩隻中間)時歸「rank 較大者」= 較弱的那隻 —— 這條規則是用 paldb 反推的:
 * 反過來歸較強者會把 絹笠蛾+波魯傑克斯→墨羅娜 算成 75%(實測 83.3%)、金棘獸自交算成 14.9%
 * (實測 17%);歸較弱者則兩者與其他已知值全部吻合,全量 495,068 筆有 93.5% 完全一致。
 */
export function mutationOutcomes(index: MutationIndex, rankA: number, rankB: number): MutationOutcome[] {
  const { lo, hi } = mutationWindow(rankA, rankB);
  const start = Math.floor(lo) + 1;
  const end = Math.floor(hi);
  if (end < start || !index.eligible.length) return [];

  const counts = new Map<string, number>();
  let total = 0;
  for (let v = start; v <= end; v++) {
    let best: MutationPal | null = null;
    let bestDist = Infinity;
    for (const p of index.eligible) {
      const d = Math.abs(p.rank - v);
      if (d < bestDist || (d === bestDist && best !== null && p.rank > best.rank)) {
        best = p;
        bestDist = d;
      }
    }
    if (!best) continue;
    counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
    total++;
  }
  if (!total) return [];
  return [...counts.entries()]
    .map(([id, n]) => ({ pal: index.byId.get(id)!, chance: n / total }))
    .sort((a, b) => b.chance - a.chance || a.pal.rank - b.pal.rank);
}

/**
 * 目標可由突變產出時,父母的「等效繁殖值」需落在哪個區間。
 * 兩隻同種(min=max=r)時窗口為 [0.505r, 0.605r],故 r ∈ [rank/0.605, rank/0.505];
 * 異種父母的可行組合更廣,實際仍以 findMutationPairs 逐對驗算為準,這裡只作為提示。
 */
export function requiredParentAvg(rank: number): { lo: number; hi: number }[] {
  const lo = rank / (WINDOW_COEF.hMin + WINDOW_COEF.hMax);
  const hi = rank / (WINDOW_COEF.lMin + WINDOW_COEF.lMax);
  return [{ lo, hi }];
}

export interface MutationPair {
  a: MutationPal;
  b: MutationPal;
  /** 已知突變時生出目標的條件機率 */
  chance: number;
  /** 每顆蛋生出目標的機率 = 觸發率 × 條件機率 */
  perEgg: number;
  /** 期望顆數(達成一次目標所需的蛋數) */
  expectedEggs: number;
  /** 這對父母突變時的所有可能結果數 */
  outcomes: number;
}

/**
 * 找出能突變出 target 的父母組合。
 * @param pool 允許當父母的物種(通常是玩家擁有的;傳 null = 全部 299 種)
 */
export function findMutationPairs(
  index: MutationIndex,
  targetId: string,
  pool: Set<string> | null,
  cake: CakeKind = "deluxe",
  limit = 60,
): MutationPair[] {
  const target = index.byId.get(targetId);
  if (!target || target.mut !== 1) return [];
  const rate = MUTATION_RATE[cake];
  const all = [...index.byId.values()].filter((p) => !pool || pool.has(p.id.toLowerCase()));



  const out: MutationPair[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      // 快篩:窗口一定要涵蓋目標繁殖值,否則不必展開完整分佈
      const w = mutationWindow(a.rank, b.rank);
      if (target.rank < w.lo - 10 || target.rank > w.hi + 10) continue;
      const outcomes = mutationOutcomes(index, a.rank, b.rank);
      const hit = outcomes.find((o) => o.pal.id === targetId);
      if (!hit) continue;
      const perEgg = rate * hit.chance;
      out.push({
        a, b, chance: hit.chance, perEgg,
        expectedEggs: perEgg > 0 ? 1 / perEgg : Infinity,
        outcomes: outcomes.length,
      });
    }
  }
  out.sort((x, y) => y.chance - x.chance || x.a.rank - y.a.rank);
  return out.slice(0, limit);
}

/** 在 n 顆蛋內至少成功一次的機率。 */
export function atLeastOnce(perEgg: number, eggs: number): number {
  if (perEgg <= 0) return 0;
  return 1 - Math.pow(1 - perEgg, eggs);
}

/** 要達到 confidence 把握需要幾顆蛋。 */
export function eggsForConfidence(perEgg: number, confidence = 0.9): number {
  if (perEgg <= 0) return Infinity;
  if (perEgg >= 1) return 1;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - perEgg));
}

/**
 * 期望顆數 → 實際耗時(秒)。蔬菜蛋糕一輪產兩顆,故所需輪數 = 顆數 / eggsPerCycle。
 * @param boosted 據點內有滿星梁葉龍或寶寶保母(兩者不可疊加,取高者)
 */
export function eggsToSeconds(eggs: number, cake: CakeKind, farm: FarmKind, boosted: boolean): number {
  if (!Number.isFinite(eggs)) return Infinity;
  const per = boosted ? FARMS[farm].boosted : FARMS[farm].base;
  return (eggs / CAKES[cake].eggsPerCycle) * per;
}

/** 秒數 → 「3 天 4 小時」這類易讀字串。 */
export function humanDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const m = sec / 60;
  if (m < 60) return `${Math.round(m)} 分`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)} 小時`;
  return `${(h / 24).toFixed(1)} 天`;
}
