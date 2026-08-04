#!/usr/bin/env node
// 盤點:每個地圖分類的「右側詳細面板」實際能顯示什麼。
//
// 交叉比對三份資料,不靠印象判斷:
//   map-points.json  座標、專屬名稱、等級、Z 軸、是否收集品
//   map-detail.json  寶箱掉落 / 筆記全文 / 任務 / 事件 / 技能果實
//   map-panel.json   古代遺跡與藏寶圖的掉落表(map-detail-views 端點)
//
// 用法(專案根目錄):node tools/report-panel-coverage.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const read = (f) => {
  const p = path.join(WEB, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

const points = read("map-points.json");
const detail = read("map-detail.json");
const panel = read("map-panel.json");
if (!points) {
  console.error("缺 map-points.json,請先跑 tools/fetch-map-points.mjs");
  process.exit(1);
}

const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
/** 容差一格的查表 —— 兩邊座標各自四捨五入過,整數邊界上會差一格 */
const near = (table, x, y) => {
  if (!table) return false;
  if (table[key(x, y)] !== undefined) return true;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) if (table[key(x + dx, y + dy)] !== undefined) return true;
  return false;
};

const P = panel?.panels ?? {};
/** 這個分類的座標,有幾個能在某份詳細資料裡查到內容 */
function contentCount(cat, rows) {
  let n = 0;
  for (const r of rows) {
    const [x, y, , , sub] = r;
    if (cat === "LootTower" && near(P.lootTower, x, y)) n++;
    else if (cat === "TreasureMap" && near(P.treasureMap, x, y)) n++;
    else if (cat.startsWith("Chestbox") && near(detail?.chestAt, x, y)) n++;
    else if (cat === "SkillFruits" && near(detail?.fruitAt, x, y)) n++;
    else if (cat === "Incident" && near(detail?.incidentAt, x, y)) n++;
    else if (cat === "Note" && detail?.notes?.[sub]) n++;
    else if (detail?.missions?.[sub]) n++;
  }
  return n;
}

const SOURCE = {
  LootTower: "map-detail-views",
  TreasureMap: "map-detail-views",
  ChestboxNormal: "chest-views",
  ChestboxOilrig: "chest-views",
  ChestboxOilrigGoal: "chest-views",
  Note: "note-views",
  Quest: "mission-views",
  Incident: "incident-views",
  SkillFruits: "skill-fruit-views",
};

const rows = [];
for (const [cat, info] of Object.entries(points.categories)) {
  const pts = points.points[cat] ?? [];
  const named = pts.filter((r) => r[5]).length;
  const lv = pts.filter((r) => typeof r[6] === "number" && r[6] > 0).length;
  const z = pts.filter((r) => r[3] !== 0).length;
  const content = contentCount(cat, pts);
  rows.push({
    cat,
    label: info.label,
    group: info.group,
    n: info.count,
    content,
    named,
    lv,
    z,
    collect: info.group === "collect",
    source: SOURCE[cat] ?? "",
  });
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const rich = rows.filter((r) => r.content > 0);
const named = rows.filter((r) => r.content === 0 && r.named > 0);
const bare = rows.filter((r) => r.content === 0 && r.named === 0);

const show = (title, list, extra) => {
  console.log(`\n${title}`);
  console.log("  " + "─".repeat(96));
  console.log(`  ${"分類".padEnd(20)}${"總數".padStart(6)}${"有內容".padStart(8)}${"名稱".padStart(7)}${"等級".padStart(6)}${"Z".padStart(6)}  ${extra}`);
  for (const r of list.sort((a, b) => b.n - a.n)) {
    console.log(
      `  ${r.label.padEnd(20)}${String(r.n).padStart(6)}` +
        `${(r.content ? `${r.content} (${pct(r.content, r.n)}%)` : "-").padStart(11)}` +
        `${(r.named ? pct(r.named, r.n) + "%" : "-").padStart(7)}` +
        `${(r.lv ? pct(r.lv, r.n) + "%" : "-").padStart(6)}` +
        `${(r.z ? pct(r.z, r.n) + "%" : "-").padStart(6)}  ${r.source || (r.collect ? "(可標記已收集)" : "")}`,
    );
  }
};

console.log(`地圖分類 ${rows.length} 類、標記 ${rows.reduce((a, r) => a + r.n, 0)} 個`);
show("【A】面板有實際內容(掉落表 / 全文 / 事件清單)", rich, "資料來源");
show("【B】只有專屬名稱,沒有掉落資料", named, "");
show("【C】只有座標(面板僅標題 + 座標)", bare, "");

const sum = (l) => l.reduce((a, r) => a + r.n, 0);
console.log(`\n合計:A ${rich.length} 類 / ${sum(rich)} 個標記(其中 ${rich.reduce((a, r) => a + r.content, 0)} 個查得到內容)`);
console.log(`      B ${named.length} 類 / ${sum(named)} 個`);
console.log(`      C ${bare.length} 類 / ${sum(bare)} 個`);
console.log(`      可標記已收集的分類:${rows.filter((r) => r.collect).length} 類 / ${sum(rows.filter((r) => r.collect))} 個`);
