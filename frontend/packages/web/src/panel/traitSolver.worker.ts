// 詞條配種解算 Web Worker:solveBreeding 要跑數秒,放主執行緒會凍結整個 UI,
// 丟到 worker 讓介面在計算期間保持可互動。訊息帶 seq,呼叫端據此丟棄過期結果。
import { solveBreeding, type BreedingData, type BreedingSolution } from "../breedingSolver";
import type { SaveBreedingPal } from "@palserver/shared";

export interface TraitSolveRequest {
  seq: number;
  data: BreedingData;
  owned: SaveBreedingPal[];
  targetId: string;
  desired: string[];
  maxGenerations: number;
}

export interface TraitSolveResponse {
  seq: number;
  solution: BreedingSolution | null;
  error?: string;
}

const post = (m: TraitSolveResponse) => (self as { postMessage(m: TraitSolveResponse): void }).postMessage(m);

self.addEventListener("message", (e: MessageEvent<TraitSolveRequest>) => {
  const { seq, data, owned, targetId, desired, maxGenerations } = e.data;
  try {
    post({ seq, solution: solveBreeding(data, owned, targetId, desired, maxGenerations) });
  } catch (err) {
    post({ seq, solution: null, error: String(err) });
  }
});
