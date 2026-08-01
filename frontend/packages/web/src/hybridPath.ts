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
 * 從 from 走到 to 的最短路徑;mode 決定可用的邊。
 * 先比代數,再比整體成功機率。maxDepth 預設 6(配種表最大深度為 7)。
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
  const overall = steps.reduce((acc, s) => acc * s.perEgg, 1);
  const expectedEggs = steps.reduce((acc, s) => acc + (s.perEgg > 0 ? 1 / s.perEgg : Infinity), 0);
  return { steps, overall, expectedEggs, mutationSteps: steps.filter((s) => s.kind === "mutation").length };
}

/**
 * 直系步驟要挑夥伴時,列出所有能從 from 生出 child 的夥伴。
 * (breedingTable 的 edgeOptions 已提供,這裡只補型別轉接用的說明。)
 */
export function isMutationOnlyReachable(reach: MutationReach, from: string, to: string): boolean {
  return reach.get(from)?.has(to) ?? false;
}
