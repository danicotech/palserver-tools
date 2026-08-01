// 驗算詞條 × 變異解算器:每條回傳的路線都必須真的把詞條送到目標
import { readFileSync } from "node:fs";
import { buildBreedingIndex, type BreedingData } from "../src/breedingTable";
import { buildMutationIndex, type MutationData } from "../src/mutationTable";
import { buildCarrierReach, buildMutationReach, buildTraitGraph, MUTATION_INHERIT, type PathMode, type PathStrategy } from "../src/hybridPath";

const bd = JSON.parse(readFileSync("public/game-data/breeding.json", "utf-8")) as BreedingData;
const md = JSON.parse(readFileSync("public/game-data/mutation.json", "utf-8")) as MutationData;
const index = buildBreedingIndex(bd);
const mut = buildMutationIndex(md);
const reach = buildMutationReach(mut, null);
const species = [...index.speciesSet];
const byZh = new Map(md.pals.map((p) => [p.zh, p.id]));

// 固定亂數:讓 60 個物種各持有一組詞條(模擬「全服玩家手上的帕魯」)
let seed = 20260801;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const desired = ["工匠精神", "夜行性", "社畜", "沉著冷靜"];
const masks = new Map<string, number[]>();
for (const sp of species) if (rnd() < 0.2) masks.set(sp, [1 << Math.floor(rnd() * 4)]);
// 再讓幾隻同時帶兩個,模擬真實資料
for (const sp of species) if (rnd() < 0.03) masks.set(sp, [(1 << Math.floor(rnd() * 4)) | (1 << Math.floor(rnd() * 4))]);
const masksOf = (sp: string) => masks.get(sp) ?? [0];
const pc = (x: number) => x.toString(2).split("").filter((c) => c === "1").length;

let pass = 0;
let fail = 0;
const bad: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (ok) pass++;
  else {
    fail++;
    if (bad.length < 12) bad.push(msg);
  }
};

const t0 = Date.now();
const carrier = buildCarrierReach(mut, masks);
console.log(`帶詞條物種 ${[...masks.keys()].length} 隻,carrierReach ${Date.now() - t0} ms`);

for (const targetZh of ["阿努比斯", "BlueDragon", "CatMage_Fire", "Serpent_Ground"]) {
  const target = byZh.get(targetZh) ?? targetZh;
  if (!index.speciesSet.has(target)) { console.log(`  (跳過 ${targetZh})`); continue; }
  for (const mode of ["hybrid", "mutation"] as PathMode[]) {
    for (const strategy of ["short", "odds"] as PathStrategy[]) {
      const t1 = Date.now();
      const g = buildTraitGraph(index, mut, reach, carrier, target, mode, "deluxe", { desired, masks, inherit: MUTATION_INHERIT }, 6, strategy);
      const ms = Date.now() - t1;
      const full = (1 << desired.length) - 1;
      let checked = 0;
      for (const [start] of g.starts) {
        const path = g.solve(start);
        if (!path) {
          check(false, `${targetZh}/${mode}/${strategy}: ${start} 在 starts 裡卻解不出路線`);
          continue;
        }
        checked++;
        const st = path.steps;
        check(st[0].from === start, `${targetZh}/${mode}: 首列不是初代 ${start}`);
        check((st[0].fromNeed! & ~masksOf(start).reduce((a, b) => a | b, 0)) === 0, `${targetZh}/${mode}: 初代 ${start} 補不了 ${st[0].fromNeed}`);
        check(masksOf(start).some((m) => (st[0].fromNeed! & ~m) === 0), `${targetZh}/${mode}: 初代 ${start} 沒有單一個體帶得齊`);
        check(st[st.length - 1].child === target, `${targetZh}/${mode}: 末列不是目標`);
        check(st[st.length - 1].childNeed === full, `${targetZh}/${mode}: 目標詞條沒帶齊(${st[st.length - 1].childNeed} ≠ ${full})`);
        st.forEach((s, i) => {
          check((s.childNeed! & ~(s.fromNeed! | s.partnerNeed!)) === 0, `${targetZh}/${mode}: 第 ${i} 步父母帶不齊子代詞條`);
          check(masksOf(s.partner).some((m) => (s.partnerNeed! & ~m) === 0) || s.partnerNeed === 0, `${targetZh}/${mode}: 第 ${i} 步夥伴 ${s.partner} 帶不動 ${s.partnerNeed}`);
          if (s.kind === "mutation") check(pc(s.childNeed!) <= MUTATION_INHERIT, `${targetZh}/${mode}: 突變步驟卻要帶 ${pc(s.childNeed!)} 個詞條`);
          if (i > 0) {
            check(st[i - 1].child === s.from, `${targetZh}/${mode}: 第 ${i} 步接不上`);
            check(st[i - 1].childNeed === s.fromNeed, `${targetZh}/${mode}: 第 ${i} 步詞條接不上`);
          }
          if (mode === "mutation") check(s.kind === "mutation", `${targetZh}: 純變異模式出現直系步驟`);
        });
      }
      console.log(`  ${targetZh} / ${mode} / ${strategy}: 初代 ${g.starts.size} 隻(驗 ${checked} 條),建圖 ${ms} ms`);
    }
  }
}

// 純變異 + 4 個詞條:突變一次只帶得動 2 個 → 必須無解
{
  const target = byZh.get("阿努比斯")!;
  const g = buildTraitGraph(index, mut, reach, carrier, target, "mutation", "deluxe", { desired, masks, inherit: MUTATION_INHERIT }, 6, "short");
  check(g.starts.size === 0, `純變異 + 4 詞條應無解,卻回了 ${g.starts.size} 隻初代`);
  const g2 = buildTraitGraph(index, mut, reach, carrier, target, "mutation", "deluxe", { desired: desired.slice(0, 2), masks, inherit: MUTATION_INHERIT }, 6, "short");
  console.log(`  純變異 4 詞條 → ${g.starts.size} 隻初代;2 詞條 → ${g2.starts.size} 隻初代`);
}

console.log(`\n通過 ${pass} / 失敗 ${fail}`);
for (const b of bad) console.log("  ❌", b);
process.exit(fail ? 1 : 0);
