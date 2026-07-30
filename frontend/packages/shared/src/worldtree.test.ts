import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorldTreeCoord, savToMap, savToWorldTreeMap } from "./index.js";

// 已知世界樹地標(paldb.cc treemap_data_en.js fixedDungeon;7 隻 Lv74-79 Alpha,
// 與 game8 攻略「7 mapped Alpha, Lv74–79」交叉吻合)。
// 出處與研究:.claude/notes/worldtree-map-research.md
const TREE_BOSSES: [string, number, number][] = [
  ["Dualith", 517450, -626940],
  ["Celesdir Noct", 520440, -727175],
  ["Whalaska Ignis", 526910, -581728],
  ["Mycora", 458095, -694560],
  ["Moldron Cryst", 571870, -733420],
  ["Renjishi", 601097, -572063],
  ["Aegidron", 491581, -725697],
];

test("isWorldTreeCoord:世界樹地標全部命中,主世界代表點全部不命中", () => {
  for (const [, x] of TREE_BOSSES) assert.equal(isWorldTreeCoord(x), true);
  // 主世界代表點:出生地平原、櫻島、Feybreak(皆 X < 349400)
  for (const x of [0, -260000, 200000, 349000, -1099000]) {
    assert.equal(isWorldTreeCoord(x), false, `主世界 X=${x} 不該判為世界樹`);
  }
});

test("savToWorldTreeMap:地標全部落在 ±1000 底圖內,相對方位正確", () => {
  for (const [name, x, y] of TREE_BOSSES) {
    const m = savToWorldTreeMap(x, y);
    assert.ok(m.x > -1000 && m.x < 1000 && m.y > -1000 && m.y < 1000, `${name} 超出底圖:${JSON.stringify(m)}`);
  }
  // 相對方位(savX 大=北、savY 大=東):Renjishi savX 最大 → 最北;
  // Mycora savX 最小 → 最南;Moldron savY 最小 → 最西
  const byName = Object.fromEntries(TREE_BOSSES.map(([n, x, y]) => [n, savToWorldTreeMap(x, y)]));
  const ys = Object.values(byName).map((m) => m.y);
  const xs = Object.values(byName).map((m) => m.x);
  assert.equal(byName["Renjishi"].y, Math.max(...ys));
  assert.equal(byName["Mycora"].y, Math.min(...ys));
  assert.equal(byName["Moldron Cryst"].x, Math.min(...xs));
});

test("世界樹座標誤用主世界 savToMap 會飛出主世界底圖(這就是要分兩張圖的原因)", () => {
  const m = savToMap(517450, -626940); // Dualith 用主世界公式
  // 主世界底圖 y 上界約 1031(IMAGE_BOUNDS),世界樹的 X 會把 y 推到 ~1397
  assert.ok(m.y > 1100, `預期遠超主世界北界,實得 ${m.y}`);
});
