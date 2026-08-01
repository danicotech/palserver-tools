/**
 * 混合路徑解算 —— 讓「最短路徑」能同時走直系配方與突變。
 *
 * 三種模式:
 *   pure     只走直系配方(A+B=C 查表),100% 必得,與 breedingTable 的結果一致
 *   hybrid   直系與突變都可用,優先代數少;同代數時優先成功機率高
 *   mutation 全程只走突變(每一步都靠突變蛋)
 *
 * 突變邊的取得方式:對來源物種 X,列舉全部 299 個夥伴 Y,算出 X+Y 的突變窗口分佈,
 * 對每個可能的突變子代只留「機率最高的那個夥伴」。這份 X → 子代 的可達表會快取,
 * 之後的 BFS 就只是查表。
 */
import type { BreedingTableIndex } from "./breedingTable";
import { stepChildren } from "./breedingTable";
import { mutationOutcomes, MUTATION_RATE, type CakeKind, type MutationIndex } from "./mutationTable";

export type PathMode = "pure" | "hybrid" | "mutation";

export interface MutationEdge {
  /** 最佳夥伴(與來源配對) */
  partner: string;
  /** 已發生突變時得到此子代的條件機率 */
  chance: number;
}

/** 來源物種 → (突變子代 → 最佳夥伴與機率)。 */
export type MutationReach = Map<string, Map<string, MutationEdge>>;

/**
 * 建立突變可達表。299×299 次窗口計算,約需數百毫秒,故由呼叫端快取。
 * @param pool 限定可當夥伴的物種(玩家擁有的);null = 全部
 */
export function buildMutationReach(mut: MutationIndex, pool: Set<string> | null): MutationReach {
  const all = [...mut.byId.values()];
  const partners = pool ? all.filter((p) => pool.has(p.id.toLowerCase())) : all;
  const reach: MutationReach = new Map();
  for (const src of all) {
    const m = new Map<string, MutationEdge>();
    for (const partner of partners) {
      for (const o of mutationOutcomes(mut, src.rank, partner.rank)) {
        const prev = m.get(o.pal.id);
        if (!prev || o.chance > prev.chance) m.set(o.pal.id, { partner: partner.id, chance: o.chance });
      }
    }
    reach.set(src.id, m);
  }
  return reach;
}

export interface HybridStep {
  /** 這一步的來源(上一代留下來的那隻) */
  from: string;
  /** 與誰配 */
  partner: string;
  /** 生出誰 */
  child: string;
  kind: "breed" | "mutation";
  /** 突變步驟:已突變時得到 child 的條件機率;直系步驟為 1 */
  chance: number;
  /** 突變步驟:每顆蛋成功的機率(= 觸發率 × chance);直系步驟為 1 */
  perEgg: number;
  /** 詞條模式:from 這隻必須帶著的詞條(bitmask,對應 TraitCtx.desired 的位) */
  fromNeed?: number;
  /** 詞條模式:夥伴必須帶進來的詞條 */
  partnerNeed?: number;
  /** 詞條模式:這一列配出來的子代身上會有的詞條 */
  childNeed?: number;
}

export interface HybridPath {
  steps: HybridStep[];
  /** 全程都成功的每顆蛋機率(直系步驟視為 1) */
  overall: number;
  /** 走完全程的期望蛋數(各突變步驟期望值相加;直系步驟算 1 顆) */
  expectedEggs: number;
  mutationSteps: number;
}

/**
 * 挑路線的偏好:
 *   short 代數最少(同代數時再挑成功率高的)
 *   odds  期望蛋數最少 —— 突變步驟的成本是 1/每顆蛋機率,多繞一代但走高機率的
 *         突變組合,實際往往比硬拚一步到位省得多。
 */
export type PathStrategy = "short" | "odds";

/**
 * 從 from 走到 to 的路徑;mode 決定可用的邊,strategy 決定怎麼挑。
 * maxDepth 預設 6(配種表最大深度為 7)。
 */
export function solveHybrid(
  index: BreedingTableIndex,
  mut: MutationIndex,
  reach: MutationReach,
  from: string,
  to: string,
  mode: PathMode,
  cake: CakeKind,
  maxDepth = 6,
  strategy: PathStrategy = "short",
): HybridPath | null {
  if (strategy === "odds") return solveByEggs(index, mut, reach, from, to, mode, cake, maxDepth);
  return solveByDepth(index, mut, reach, from, to, mode, cake, maxDepth);
}

/** 列出某物種的所有可走邊(直系 + 突變),供兩種策略共用。 */
function edgesFrom(
  index: BreedingTableIndex,
  reach: MutationReach,
  species: string,
  mode: PathMode,
  rate: number,
): HybridStep[] {
  const out: HybridStep[] = [];
  if (mode !== "mutation") {
    for (const child of stepChildren(index, species)) {
      if (child !== species) out.push({ from: species, partner: "", child, kind: "breed", chance: 1, perEgg: 1 });
    }
  }
  if (mode !== "pure") {
    for (const [child, edge] of reach.get(species) ?? []) {
      if (child !== species)
        out.push({ from: species, partner: edge.partner, child, kind: "mutation", chance: edge.chance, perEgg: rate * edge.chance });
    }
  }
  return out;
}

function assemble(steps: HybridStep[]): HybridPath {
  const overall = steps.reduce((acc, s) => acc * s.perEgg, 1);
  const expectedEggs = steps.reduce((acc, s) => acc + (s.perEgg > 0 ? 1 / s.perEgg : Infinity), 0);
  return { steps, overall, expectedEggs, mutationSteps: steps.filter((s) => s.kind === "mutation").length };
}

/** 期望蛋數最少:成本可加(每步 1/perEgg),用 Dijkstra;深度仍受 maxDepth 限制。 */
function solveByEggs(
  index: BreedingTableIndex,
  mut: MutationIndex,
  reach: MutationReach,
  from: string,
  to: string,
  mode: PathMode,
  cake: CakeKind,
  maxDepth: number,
): HybridPath | null {
  const rate = MUTATION_RATE[cake];
  interface N {
    species: string;
    cost: number;
    depth: number;
    step: HybridStep | null;
    prev: N | null;
  }
  const best = new Map<string, N>();
  const start: N = { species: from, cost: 0, depth: 0, step: null, prev: null };
  best.set(from, start);
  // 節點數上限 299,直接每輪線性取最小即可,不必上堆。
  const queue: N[] = [start];
  const done = new Set<string>();
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[bi].cost) bi = i;
    const node = queue.splice(bi, 1)[0];
    if (done.has(node.species)) continue;
    done.add(node.species);
    if (node.species === to) break;
    if (node.depth >= maxDepth) continue;
    for (const e of edgesFrom(index, reach, node.species, mode, rate)) {
      if (e.perEgg <= 0) continue;
      const cost = node.cost + 1 / e.perEgg;
      const prev = best.get(e.child);
      if (!prev || cost < prev.cost) {
        const n: N = { species: e.child, cost, depth: node.depth + 1, step: e, prev: node };
        best.set(e.child, n);
        queue.push(n);
      }
    }
  }
  const goal = best.get(to);
  if (!goal || !goal.step) return null;
  const steps: HybridStep[] = [];
  for (let n: N | null = goal; n && n.step; n = n.prev) steps.unshift(n.step);
  return assemble(steps);
}

function solveByDepth(
  index: BreedingTableIndex,
  mut: MutationIndex,
  reach: MutationReach,
  from: string,
  to: string,
  mode: PathMode,
  cake: CakeKind,
  maxDepth = 6,
): HybridPath | null {
  if (from === to) return { steps: [], overall: 1, expectedEggs: 0, mutationSteps: 0 };
  const rate = MUTATION_RATE[cake];

  /** 每個節點目前最好的走法(先短後機率高)。 */
  interface Node {
    species: string;
    depth: number;
    logP: number; // 累積 log 機率(避免連乘下溢)
    step: HybridStep | null;
    prev: Node | null;
  }
  const best = new Map<string, Node>();
  const startNode: Node = { species: from, depth: 0, logP: 0, step: null, prev: null };
  best.set(from, startNode);
  let frontier: Node[] = [startNode];

  const better = (a: Node, b: Node | undefined) =>
    !b || a.depth < b.depth || (a.depth === b.depth && a.logP > b.logP);

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      // 直系配方邊
      if (mode !== "mutation") {
        for (const child of stepChildren(index, node.species)) {
          if (child === node.species) continue;
          const cand: Node = {
            species: child,
            depth,
            logP: node.logP,
            step: { from: node.species, partner: "", child, kind: "breed", chance: 1, perEgg: 1 },
            prev: node,
          };
          if (better(cand, best.get(child))) {
            best.set(child, cand);
            next.push(cand);
          }
        }
      }
      // 突變邊
      if (mode !== "pure") {
        const m = reach.get(node.species);
        if (m) {
          for (const [child, edge] of m) {
            if (child === node.species) continue;
            const perEgg = rate * edge.chance;
            const cand: Node = {
              species: child,
              depth,
              logP: node.logP + Math.log(perEgg),
              step: { from: node.species, partner: edge.partner, child, kind: "mutation", chance: edge.chance, perEgg },
              prev: node,
            };
            if (better(cand, best.get(child))) {
              best.set(child, cand);
              next.push(cand);
            }
          }
        }
      }
    }
    frontier = next;
    // 已找到目標且本層不可能再更短 → 收工
    if (best.has(to) && best.get(to)!.depth <= depth) break;
  }

  const goal = best.get(to);
  if (!goal || !goal.step) return null;
  const steps: HybridStep[] = [];
  for (let n: Node | null = goal; n && n.step; n = n.prev) steps.unshift(n.step);
  return assemble(steps);
}

export interface StepOption {
  partner: string;
  kind: "breed" | "mutation";
  /** 直系 = 1;突變 = 已突變時中獎的條件機率 */
  chance: number;
  /** 每顆蛋成功機率(直系 = 1) */
  perEgg: number;
}

/**
 * 某一步「from → child」的所有作法:直系配方的合法夥伴(必得),
 * 以及能突變出 child 的夥伴(附機率)。供 UI 讓玩家自己挑夥伴。
 */
export function stepOptions(
  index: BreedingTableIndex,
  mut: MutationIndex,
  from: string,
  child: string,
  mode: PathMode,
  cake: CakeKind,
): StepOption[] {
  const out: StepOption[] = [];
  if (mode !== "mutation") {
    for (const r of index.byChild.get(child) ?? []) {
      const [p1, , p2] = r;
      const partner = p1 === from ? p2 : p2 === from ? p1 : null;
      if (partner) out.push({ partner, kind: "breed", chance: 1, perEgg: 1 });
    }
  }
  if (mode !== "pure") {
    const src = mut.byId.get(from);
    if (src) {
      const rate = MUTATION_RATE[cake];
      for (const p of mut.byId.values()) {
        const hit = mutationOutcomes(mut, src.rank, p.rank).find((o) => o.pal.id === child);
        if (hit) out.push({ partner: p.id, kind: "mutation", chance: hit.chance, perEgg: rate * hit.chance });
      }
    }
  }
  // 直系(必得)排前面,其次突變機率高者
  const seen = new Set<string>();
  return out
    .filter((o) => {
      const k = `${o.kind} ${o.partner}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.perEgg - a.perEgg || a.partner.localeCompare(b.partner));
}

export interface StartCandidate {
  /** 幾代可到目標 */
  depth: number;
  /** 全程每輪成功率(直系步驟算 1);純直系模式恆為 1 */
  overall: number;
  /** 路線中有幾步要靠突變 */
  mutationSteps: number;
}

/**
 * 反向 BFS:從目標往回推,一次算出「哪些帕魯能當初代」以及各自要幾代。
 * 這是 UI 的關鍵 —— 選完目標就能直接把可用的初代標出來,不必逐一試。
 */
export function startCandidates(
  index: BreedingTableIndex,
  mut: MutationIndex,
  reach: MutationReach,
  target: string,
  mode: PathMode,
  cake: CakeKind,
  maxDepth = 6,
): Map<string, StartCandidate> {
  const rate = MUTATION_RATE[cake];

  // 反向鄰接:child → 可作為「上一代留下來那隻」的來源
  const rev = new Map<string, { src: string; kind: "breed" | "mutation"; perEgg: number }[]>();
  const push = (child: string, e: { src: string; kind: "breed" | "mutation"; perEgg: number }) => {
    const list = rev.get(child);
    if (list) list.push(e);
    else rev.set(child, [e]);
  };
  if (mode !== "mutation") {
    for (const parent of index.speciesSet) {
      for (const child of stepChildren(index, parent)) {
        if (child !== parent) push(child, { src: parent, kind: "breed", perEgg: 1 });
      }
    }
  }
  if (mode !== "pure") {
    for (const [src, children] of reach) {
      for (const [child, edge] of children) {
        if (child !== src) push(child, { src, kind: "mutation", perEgg: rate * edge.chance });
      }
    }
  }

  const out = new Map<string, StartCandidate>();
  let frontier = new Map<string, StartCandidate>([[target, { depth: 0, overall: 1, mutationSteps: 0 }]]);
  for (let depth = 1; depth <= maxDepth && frontier.size; depth++) {
    const next = new Map<string, StartCandidate>();
    for (const [node, info] of frontier) {
      for (const e of rev.get(node) ?? []) {
        const cand: StartCandidate = {
          depth,
          overall: info.overall * e.perEgg,
          mutationSteps: info.mutationSteps + (e.kind === "mutation" ? 1 : 0),
        };
        const prev = out.get(e.src) ?? next.get(e.src);
        // 先短後機率高;已在更淺層出現過就不覆蓋
        if (!prev || cand.depth < prev.depth || (cand.depth === prev.depth && cand.overall > prev.overall)) {
          if (e.src !== target) next.set(e.src, cand);
        }
      }
    }
    for (const [k, v] of next) if (!out.has(k)) out.set(k, v);
    frontier = next;
  }
  return out;
}

// ── 詞條約束下的路線 ──────────────────────────────────────────────────
//
// 詞條(被動技能)只能從「真的有人擁有的帕魯」帶進來,子代拿到的是雙親的聯集。
// 直系配種一次最多帶四格,但**突變蛋固定佔兩格彩虹詞條,只剩兩格繼承父母**
// (巴哈整理:「突變必定自帶 2 個虹詞,然後再從父母身上繼承兩個詞條」),
// 所以突變步驟一次最多只帶得動兩個指定詞條 —— 這是變異路線最硬的限制。
//
// 解法:狀態 =(物種, 還缺哪些詞條),從「目標 + 全部詞條」反向搜。
// 反向邊 (X, needX) --夥伴 Y--> (C, needC) 的條件:
//   直系  needX = needC & ~mask(Y)
//   突變  同上,且 popcount(needC) ≤ inherit
// 終點:某個 (X, need) 能被 X 物種實際擁有的個體詞條涵蓋 → X 可當初代。
// 於是「找得到路線」等價於「目標一定帶得齊詞條」,找不到就是真的配不出來。

/** 突變蛋能從父母繼承幾個詞條(另外兩格固定是彩虹詞條)。 */
export const MUTATION_INHERIT = 2;

export interface TraitCtx {
  /** 要帶到目標身上的詞條;bit i 對應 desired[i] */
  desired: string[];
  /** 物種 → 範圍內真的有人擁有的詞條組合(bitmask,只留極大值);未列出者只能提供 0 */
  masks: Map<string, number[]>;
  /** 一次突變能從父母帶走幾個詞條 */
  inherit: number;
}

/** 詞條模式專用的突變可達表:來源 → 子代 → 夥伴詞條 → 最佳夥伴。 */
export type MaskReach = Map<string, Map<string, Map<number, MutationEdge>>>;

/**
 * 建立「帶詞條夥伴」的突變可達表。夥伴池限定為真的有人持有所選詞條的物種,
 * 通常遠少於 299,所以比全表便宜得多。
 */
export function buildCarrierReach(mut: MutationIndex, masks: Map<string, number[]>): MaskReach {
  const carriers = [...mut.byId.values()]
    .map((p) => ({ pal: p, ms: (masks.get(p.id) ?? []).filter((m) => m !== 0) }))
    .filter((x) => x.ms.length > 0);
  const out: MaskReach = new Map();
  if (!carriers.length) return out;
  for (const src of mut.byId.values()) {
    const byChild = new Map<string, Map<number, MutationEdge>>();
    for (const { pal, ms } of carriers) {
      for (const o of mutationOutcomes(mut, src.rank, pal.rank)) {
        let byMask = byChild.get(o.pal.id);
        if (!byMask) {
          byMask = new Map();
          byChild.set(o.pal.id, byMask);
        }
        for (const m of ms) {
          const prev = byMask.get(m);
          if (!prev || o.chance > prev.chance) byMask.set(m, { partner: pal.id, chance: o.chance });
        }
      }
    }
    if (byChild.size) out.set(src.id, byChild);
  }
  return out;
}

export interface TraitGraph {
  /** 能當初代的物種 → 代數與成功率(每一筆都保證帶得齊詞條) */
  starts: Map<string, StartCandidate>;
  /** 從某初代出發的完整路線;不在 starts 裡就是 null */
  solve(from: string): HybridPath | null;
}

const ZERO_MASK = [0];
function popcount(x: number): number {
  let c = 0;
  for (let v = x; v; v &= v - 1) c++;
  return c;
}

/**
 * 反向建圖:一次算完「哪些初代帶得齊詞條」與「各自的走法」。
 * strategy 決定挑法(代數最少 / 期望蛋數最少),語意與無詞條時相同。
 */
export function buildTraitGraph(
  index: BreedingTableIndex,
  mut: MutationIndex,
  reach: MutationReach,
  carrierReach: MaskReach,
  target: string,
  mode: PathMode,
  cake: CakeKind,
  trait: TraitCtx,
  maxDepth = 6,
  strategy: PathStrategy = "short",
): TraitGraph {
  const rate = MUTATION_RATE[cake];
  const nMask = 1 << trait.desired.length;
  const full = nMask - 1;

  // 物種一律換成整數索引,狀態鍵 = 物種 × nMask + need。
  // 字串鍵的 Map 在這裡會慢一個數量級(每輪要跑上百萬次)。
  const spList = [...index.speciesSet];
  const spIdx = new Map(spList.map((s, i) => [s, i]));
  const nSp = spList.length;
  const masksBy: number[][] = spList.map((s) => trait.masks.get(s) ?? ZERO_MASK);
  const targetIdx = spIdx.get(target);
  if (targetIdx === undefined) return { starts: new Map(), solve: () => null };

  /** 反向直系邊:子代 → [來源, 夥伴] 交錯陣列。 */
  const revBreed: Int32Array[] = new Array(nSp);
  if (mode !== "mutation") {
    const tmp: number[][] = Array.from({ length: nSp }, () => []);
    for (const [child, recipes] of index.byChild) {
      const ci = spIdx.get(child);
      if (ci === undefined) continue;
      const list = tmp[ci];
      for (const r of recipes) {
        const a = spIdx.get(r[0]);
        const b = spIdx.get(r[2]);
        if (a === undefined || b === undefined) continue;
        if (a !== ci) list.push(a, b);
        if (b !== a && b !== ci) list.push(b, a);
      }
    }
    for (let i = 0; i < nSp; i++) revBreed[i] = Int32Array.from(tmp[i]);
  }

  /** 反向突變邊:子代 → 能突變出牠的(來源, 夥伴, 夥伴詞條, 條件機率)。 */
  const revMut: { src: number; partner: number; chance: number; mask: number }[][] = Array.from(
    { length: nSp },
    () => [],
  );
  if (mode !== "pure") {
    const push = (child: string, src: string, partner: string, chance: number, mask: number) => {
      const ci = spIdx.get(child);
      const si = spIdx.get(src);
      const pi = spIdx.get(partner);
      if (ci === undefined || si === undefined || pi === undefined || ci === si) return;
      revMut[ci].push({ src: si, partner: pi, chance, mask });
    };
    for (const [src, children] of reach)
      for (const [child, edge] of children) push(child, src, edge.partner, edge.chance, 0);
    for (const [src, children] of carrierReach)
      for (const [child, byMask] of children)
        for (const [mask, edge] of byMask) push(child, src, edge.partner, edge.chance, mask);
  }

  const size = nSp * nMask;
  const depthAt = new Int32Array(size).fill(-1);
  const costAt = new Float64Array(size).fill(Infinity);
  const logPAt = new Float64Array(size).fill(-Infinity);
  const mutsAt = new Int32Array(size);
  /** 路線上有幾步需要「特定一隻帶詞條的帕魯」—— 同樣好走時當然是越少越好找 */
  const carriersAt = new Int32Array(size);
  /** 往目標方向的下一步:夥伴、子代狀態、種類、機率 */
  const nextPartner = new Int32Array(size).fill(-1);
  const nextState = new Int32Array(size).fill(-1);
  const nextMut = new Uint8Array(size);
  const nextChance = new Float64Array(size);

  const root = targetIdx * nMask + full;
  depthAt[root] = 0;
  costAt[root] = 0;
  logPAt[root] = 0;
  let frontier = [root];

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const improved: number[] = [];
    for (const cur of frontier) {
      const need = cur % nMask;
      const curDepth = depthAt[cur];
      const curCost = costAt[cur];
      const curLogP = logPAt[cur];
      const curMuts = mutsAt[cur];
      const curCarriers = carriersAt[cur];
      /** 把「(src, needSrc) 配 partner 生出 cur 的物種」記進圖。 */
      const relax = (src: number, needSrc: number, partner: number, isMut: number, chance: number, perEgg: number) => {
        const k = src * nMask + needSrc;
        if (k === root) return; // 回到起始狀態沒有意義
        const cost = curCost + 1 / perEgg;
        const d = curDepth + 1;
        const logP = curLogP + Math.log(perEgg);
        // 這一步有沒有動用到「特定一隻帶詞條的帕魯」
        const carriers = curCarriers + (needSrc !== need ? 1 : 0);
        // 同深度/同成本時,先看成功率,再看要湊幾隻帶詞條的帕魯(越少越好找)
        const win =
          depthAt[k] < 0 ||
          (strategy === "odds"
            ? cost < costAt[k] - 1e-9 ||
              (cost < costAt[k] + 1e-9 && carriers < carriersAt[k])
            : d < depthAt[k] ||
              (d === depthAt[k] &&
                (logP > logPAt[k] + 1e-12 || (logP > logPAt[k] - 1e-12 && carriers < carriersAt[k]))));
        if (!win) return;
        depthAt[k] = d;
        costAt[k] = cost;
        logPAt[k] = logP;
        mutsAt[k] = curMuts + isMut;
        carriersAt[k] = carriers;
        nextPartner[k] = partner;
        nextState[k] = cur;
        nextMut[k] = isMut;
        nextChance[k] = chance;
        improved.push(k);
      };

      // 直系:兩個方向都當「上一代留下來的那隻」
      if (mode !== "mutation") {
        const adj = revBreed[(cur / nMask) | 0];
        for (let i = 0; i < adj.length; i += 2) {
          const partner = adj[i + 1];
          const ms = masksBy[partner];
          for (let j = 0; j < ms.length; j++) relax(adj[i], need & ~ms[j], partner, 0, 1, 1);
        }
      }
      // 突變:只剩兩格能繼承,子代要帶的詞條超過上限就走不了
      if (mode !== "pure" && popcount(need) <= trait.inherit) {
        const list = revMut[(cur / nMask) | 0];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const perEgg = rate * e.chance;
          if (perEgg > 0) relax(e.src, need & ~e.mask, e.partner, 1, e.chance, perEgg);
        }
      }
    }
    frontier = improved;
  }

  /** 物種 → 最佳可行狀態(初代必須用自己擁有的個體補齊剩下的詞條)。 */
  const bestStart = new Map<string, number>();
  for (let sp = 0; sp < nSp; sp++) {
    if (sp === targetIdx) continue;
    const ms = masksBy[sp];
    let bestK = -1;
    for (let need = 0; need < nMask; need++) {
      const k = sp * nMask + need;
      if (depthAt[k] < 0 || nextState[k] < 0) continue;
      if (!ms.some((m) => (need & ~m) === 0)) continue;
      if (
        bestK < 0 ||
        (strategy === "odds"
          ? costAt[k] < costAt[bestK] ||
            (costAt[k] < costAt[bestK] + 1e-9 && carriersAt[k] < carriersAt[bestK])
          : depthAt[k] < depthAt[bestK] ||
            (depthAt[k] === depthAt[bestK] &&
              (logPAt[k] > logPAt[bestK] ||
                (logPAt[k] > logPAt[bestK] - 1e-12 && carriersAt[k] < carriersAt[bestK]))))
      )
        bestK = k;
    }
    if (bestK >= 0) bestStart.set(spList[sp], bestK);
  }

  const starts = new Map<string, StartCandidate>();
  for (const [sp, k] of bestStart)
    starts.set(sp, { depth: depthAt[k], overall: Math.exp(logPAt[k]), mutationSteps: mutsAt[k] });

  return {
    starts,
    solve(from: string): HybridPath | null {
      const head = bestStart.get(from);
      if (head === undefined) return null;
      const steps: HybridStep[] = [];
      for (let k = head; nextState[k] >= 0 && steps.length <= maxDepth + 2; k = nextState[k]) {
        const child = nextState[k];
        const isMut = nextMut[k] === 1;
        const chance = isMut ? nextChance[k] : 1;
        steps.push({
          from: spList[(k / nMask) | 0],
          partner: spList[nextPartner[k]],
          child: spList[(child / nMask) | 0],
          kind: isMut ? "mutation" : "breed",
          chance,
          perEgg: isMut ? rate * chance : 1,
          fromNeed: k % nMask,
          partnerNeed: (child % nMask) & ~(k % nMask),
          childNeed: child % nMask,
        });
      }
      return steps.length ? assemble(steps) : null;
    },
  };
}
