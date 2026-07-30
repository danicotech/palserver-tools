import type { BreedingData, BreedingGender, BreedingRecipe } from "./breedingSolver";

/**
 * 配種表查詢索引 —— 純靜態查表,與 breedingSolver 的路徑搜尋互補。
 *
 * breeding.json 的 recipes 已涵蓋 299 隻可配種帕魯的全部 44,850 種無序組合
 * (C(299,2) + 299 自交),外加 1 組性別分歧配方(妮姆芙 × 芙蕾雅),共 44,851 筆。
 * 因此這裡不做任何公式推導,查不到就是資料真的沒有,而不是需要計算。
 */

/** 一組配對的結果,性別已依呼叫端給的 (a, b) 順序對位。 */
export interface PairOutcome {
  /** 放在 a 位置的親代所需性別;"*" = 不限 */
  genderA: BreedingGender;
  /** 放在 b 位置的親代所需性別;"*" = 不限 */
  genderB: BreedingGender;
  child: string;
}

/** 單親列表的一列:某親代與某夥伴配種的結果。 */
export interface PartnerOutcome extends PairOutcome {
  partner: string;
}

export interface BreedingTableIndex {
  /** 可配種物種 id(檔案出現順序) */
  species: string[];
  speciesSet: Set<string>;
  /** 無序配對鍵 → 配方(通常 1 筆,性別分歧時 2 筆) */
  byPair: Map<string, BreedingRecipe[]>;
  /** 子代 → 所有能生出牠的配方 */
  byChild: Map<string, BreedingRecipe[]>;
  /** 資料自我檢核結果,顯示在頁腳讓使用者知道這份表是否完整 */
  stats: {
    speciesCount: number;
    recipeCount: number;
    /** 實際涵蓋的無序配對數 */
    pairCount: number;
    /** 理論上應有的無序配對數 C(n,2)+n */
    expectedPairCount: number;
    /** 有性別分歧(同一對親代依性別生出不同子代)的配對數 */
    genderSplitCount: number;
  };
}

/** 無序配對鍵:排序後用 NUL 相接,(A,B) 與 (B,A) 得到同一把鍵。 */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function buildBreedingIndex(data: BreedingData): BreedingTableIndex {
  const byPair = new Map<string, BreedingRecipe[]>();
  const byChild = new Map<string, BreedingRecipe[]>();
  const speciesSet = new Set<string>();
  const species: string[] = [];

  const see = (id: string) => {
    if (!speciesSet.has(id)) {
      speciesSet.add(id);
      species.push(id);
    }
  };

  for (const recipe of data.recipes) {
    const [p1, , p2, , child] = recipe;
    see(p1);
    see(p2);
    const key = pairKey(p1, p2);
    const atPair = byPair.get(key);
    if (atPair) atPair.push(recipe);
    else byPair.set(key, [recipe]);
    const atChild = byChild.get(child);
    if (atChild) atChild.push(recipe);
    else byChild.set(child, [recipe]);
  }

  const n = speciesSet.size;
  let genderSplitCount = 0;
  for (const recipes of byPair.values()) if (recipes.length > 1) genderSplitCount += 1;

  return {
    species,
    speciesSet,
    byPair,
    byChild,
    stats: {
      speciesCount: n,
      recipeCount: data.recipes.length,
      pairCount: byPair.size,
      expectedPairCount: (n * (n - 1)) / 2 + n,
      genderSplitCount,
    },
  };
}

/**
 * 正查:a × b → 子代。回傳陣列而非單值,因為妮姆芙 × 芙蕾雅會依性別生出不同子代。
 * 性別已對位到傳入的 (a, b) 順序,呼叫端可直接顯示。
 */
export function lookupPair(index: BreedingTableIndex, a: string, b: string): PairOutcome[] {
  const recipes = index.byPair.get(pairKey(a, b));
  if (!recipes) return [];
  return recipes.map(([p1, g1, p2, g2, child]) => {
    // a === b 時兩邊同物種,原順序即正確;否則看 p1 對到哪一邊決定要不要交換性別。
    const flipped = a !== b && p1 !== a;
    return flipped
      ? { genderA: g2, genderB: g1, child }
      : { genderA: g1, genderB: g2, child };
  });
}

/** 反查:列出所有能生出 child 的親代配方(維持檔案順序,呼叫端自行排序/過濾)。 */
export function parentsOf(index: BreedingTableIndex, child: string): BreedingRecipe[] {
  return index.byChild.get(child) ?? [];
}

/**
 * 單親列表:parent 與全部 299 隻(含自己)配種的結果,一次拿完整一列配種表。
 * 性別分歧的配對會展開成多列。
 */
export function partnersOf(index: BreedingTableIndex, parent: string): PartnerOutcome[] {
  const rows: PartnerOutcome[] = [];
  for (const partner of index.species) {
    for (const outcome of lookupPair(index, parent, partner)) {
      rows.push({ ...outcome, partner });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 祖孫配種鏈:從「你擁有的 A」出發,逐代與野生夥伴配種,直到生出目標 C。
// 物種圖很密(任兩隻都有配方),BFS 最短代數通常只有 1~3 代;比最短更長的
// 路線永遠不必要(多配一代不會解鎖新物種),所以「總路徑」= 全部最短路線。
// ---------------------------------------------------------------------------

/** 一步配種中可選的夥伴(gender 為配方要求;"*" = 不限)。 */
export interface ChainPartnerOption {
  partner: string;
  /** 出發方(from)在這份配方所需的性別 */
  genderFrom: BreedingGender;
  /** 夥伴所需的性別 */
  genderPartner: BreedingGender;
}

/** 配種鏈的一步:from × 任一 partners → to。 */
export interface ChainStep {
  from: string;
  to: string;
  /** 全部可行夥伴(任選其一即可) */
  partners: ChainPartnerOption[];
}

/** 一條完整路線:species 為逐代物種鏈(含起訖),combos = 各步夥伴數的乘積。 */
export interface ChainRoute {
  species: string[];
  steps: ChainStep[];
  combos: number;
}

export interface ChainSolution {
  from: string;
  to: string;
  /** 最短代數(0 = 起點即目標) */
  distance: number;
  /** 最短「物種鏈」路線總數 */
  totalRoutes: number;
  /** 含夥伴選擇的總組合數(各路線 combos 之和) */
  totalCombos: number;
  /** 枚舉出的路線(依 combos 由大到小 = 夥伴彈性高的在前),最多 maxRoutes 條 */
  routes: ChainRoute[];
  /** totalRoutes 超過 maxRoutes 時為 true */
  truncated: boolean;
}

type StepMap = Map<string, Map<string, ChainPartnerOption[]>>;

/** 有向配種圖:from → (child → 夥伴選項)。同種自交(A×A→A)不算前進,不入圖。 */
const STEP_CACHE = new WeakMap<BreedingTableIndex, StepMap>();
function stepMapOf(index: BreedingTableIndex): StepMap {
  const cached = STEP_CACHE.get(index);
  if (cached) return cached;
  const map: StepMap = new Map();
  const add = (from: string, child: string, option: ChainPartnerOption) => {
    if (from === child) return; // 沒有物種進展的邊(自交、或 child 恰為該親)略過
    let children = map.get(from);
    if (!children) map.set(from, (children = new Map()));
    const options = children.get(child);
    if (options) options.push(option);
    else children.set(child, [option]);
  };
  for (const recipes of index.byPair.values()) {
    for (const [p1, g1, p2, g2, child] of recipes) {
      add(p1, child, { partner: p2, genderFrom: g1, genderPartner: g2 });
      if (p1 !== p2) add(p2, child, { partner: p1, genderFrom: g2, genderPartner: g1 });
    }
  }
  STEP_CACHE.set(index, map);
  return map;
}

/**
 * 求 from → to 的配種鏈:BFS 得最短代數,再在最短路 DAG 上計數與枚舉。
 * 回傳 null = 無法藉配種到達(僅發生在「只能同種配種」的傳說帕魯,或未知物種)。
 */
export function solveChain(
  index: BreedingTableIndex,
  from: string,
  to: string,
  maxRoutes = 60,
): ChainSolution | null {
  if (!index.speciesSet.has(from) || !index.speciesSet.has(to)) return null;
  if (from === to) {
    return { from, to, distance: 0, totalRoutes: 1, totalCombos: 1, routes: [{ species: [from], steps: [], combos: 1 }], truncated: false };
  }
  const steps = stepMapOf(index);

  // BFS:dist 只需鋪到 to 的層級即可,但整圖也就 ~9 萬條邊,直接鋪滿最簡單。
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    const d = dist.get(s)!;
    const children = steps.get(s);
    if (!children) continue;
    for (const child of children.keys()) {
      if (!dist.has(child)) {
        dist.set(child, d + 1);
        queue.push(child);
      }
    }
  }
  const distance = dist.get(to);
  if (distance === undefined) return null;

  // 最短路 DAG 的反向邊:child ← 前驅(dist 恰好 +1 者)
  const preds = new Map<string, string[]>();
  for (const [s, children] of steps) {
    const d = dist.get(s);
    if (d === undefined || d >= distance) continue;
    for (const child of children.keys()) {
      if (dist.get(child) === d + 1) {
        const list = preds.get(child);
        if (list) list.push(s);
        else preds.set(child, [s]);
      }
    }
  }

  // 計數(記憶化):routes = 物種鏈條數;combos 再乘上每步的夥伴數。
  const routesMemo = new Map<string, number>([[from, 1]]);
  const combosMemo = new Map<string, number>([[from, 1]]);
  const countRoutes = (node: string): number => {
    const hit = routesMemo.get(node);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const p of preds.get(node) ?? []) total += countRoutes(p);
    routesMemo.set(node, total);
    return total;
  };
  const countCombos = (node: string): number => {
    const hit = combosMemo.get(node);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const p of preds.get(node) ?? []) total += countCombos(p) * (steps.get(p)!.get(node)!.length);
    combosMemo.set(node, total);
    return total;
  };
  const totalRoutes = countRoutes(to);
  const totalCombos = countCombos(to);

  // 枚舉物種鏈(從 to 反走 DAG 到 from),前驅先走「該步夥伴多」者,湊滿 maxRoutes 為止。
  const chains: string[][] = [];
  const stack: string[] = [to];
  const walk = (node: string) => {
    if (chains.length >= maxRoutes) return;
    if (node === from) {
      chains.push([...stack].reverse());
      return;
    }
    const sorted = [...(preds.get(node) ?? [])].sort(
      (a, b) => steps.get(b)!.get(node)!.length - steps.get(a)!.get(node)!.length || a.localeCompare(b),
    );
    for (const p of sorted) {
      stack.push(p);
      walk(p);
      stack.pop();
      if (chains.length >= maxRoutes) return;
    }
  };
  walk(to);

  const routes: ChainRoute[] = chains.map((species) => {
    const routeSteps: ChainStep[] = [];
    let combos = 1;
    for (let i = 0; i + 1 < species.length; i++) {
      const partners = steps.get(species[i])!.get(species[i + 1])!;
      routeSteps.push({ from: species[i], to: species[i + 1], partners });
      combos *= partners.length;
    }
    return { species, steps: routeSteps, combos };
  });
  routes.sort((a, b) => b.combos - a.combos);

  return { from, to, distance, totalRoutes, totalCombos, routes, truncated: totalRoutes > routes.length };
}

/** from 一步配種可生出的全部物種(自交除外)。 */
export function stepChildren(index: BreedingTableIndex, from: string): string[] {
  return [...(stepMapOf(index).get(from)?.keys() ?? [])];
}

/** from × 夥伴 → to 這一步的全部夥伴選項(查無此邊回空陣列)。 */
export function edgeOptions(index: BreedingTableIndex, from: string, to: string): ChainPartnerOption[] {
  return stepMapOf(index).get(from)?.get(to) ?? [];
}

/** to 是否「只能同種配種」(全部配方都是 to×to;此時除捕捉外無法從別的物種配出)。 */
export function isSelfOnlyChild(index: BreedingTableIndex, to: string): boolean {
  const recipes = index.byChild.get(to);
  if (!recipes || recipes.length === 0) return false;
  return recipes.every(([p1, , p2]) => p1 === to && p2 === to);
}

export interface RareChild {
  child: string;
  recipes: BreedingRecipe[];
}

/**
 * 稀有子代:能生出牠的配對數 ≤ maxWays 的物種,少的排前面。
 * 只有 1 種組合的幾乎都是傳說帕魯(噴射龍、帕拉迪斯、奈克羅姆斯、冰凍馬…)的專屬配方。
 */
export function rareChildren(index: BreedingTableIndex, maxWays: number): RareChild[] {
  const rows: RareChild[] = [];
  for (const [child, recipes] of index.byChild) {
    if (recipes.length <= maxWays) rows.push({ child, recipes });
  }
  return rows.sort((x, y) => x.recipes.length - y.recipes.length);
}
