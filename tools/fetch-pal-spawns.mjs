#!/usr/bin/env node
// 產生「帕魯出生地」資料:每隻帕魯在地圖上會出現的位置(日 / 夜分開,含等級範圍)。
//
// 來源:https://s-stats-platform-cdn.op.gg/palworld/meta/spawns/{PalKey}.json
//   { schemaVersion, source, day:[{l:[x,y,z], levelMin, levelMax}], night:[...] }
// 座標與存檔同一套世界座標,經 savToMap 換算即可直接畫在既有底圖上。
//
// 為什麼要壓縮:原始檔一隻約 39 KB,200+ 隻就是 8 MB,對一個網頁來說太重。
// 這裡做三件事把它壓到可接受的大小:
//   1. 世界座標 → 地圖座標並取一位小數(地圖總寬約 3156,0.1 已經遠比一個像素細)
//   2. 丟掉 z 軸(平面地圖用不到)
//   3. 日夜合併:同一點若日夜都出現就標 2,只有白天 0、只有夜晚 1
//
// 用法(專案根目錄):
//   node tools/fetch-pal-spawns.mjs
// 產出 frontend/packages/web/public/game-data/pal-spawns.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const OUT = path.join(WEB, "pal-spawns.json");
const BASE = "https://s-stats-platform-cdn.op.gg/palworld/meta/spawns";
const CONCURRENCY = 6;

const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
const TREE_X = 350000;
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});

// 帕魯清單直接用專案既有的 pals.json —— 保證代號與頭像對得上
const pals = JSON.parse(fs.readFileSync(path.join(WEB, "pals.json"), "utf8"));
const keys = (Array.isArray(pals) ? pals : pals.pals).map((p) => p.id);
console.log(`帕魯 ${keys.length} 隻,開始抓取棲息地…`);

const spawns = {};
let ok = 0;
let none = 0;
let fail = 0;

async function one(key) {
  try {
    const r = await fetch(`${BASE}/${key}.json`, { headers: { Referer: "https://op.gg/" } });
    if (r.status === 403 || r.status === 404) {
      none++;
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    /** key = "x,y" → { when, lvMin, lvMax, tree } */
    const merged = new Map();
    const take = (list, night) => {
      for (const s of list ?? []) {
        const loc = s.l;
        if (!Array.isArray(loc) || loc.length < 2) continue;
        const { x, y } = savToMap(loc[0], loc[1]);
        const rx = Math.round(x * 10) / 10;
        const ry = Math.round(y * 10) / 10;
        const k = `${rx},${ry}`;
        const prev = merged.get(k);
        if (prev) {
          // 同一點日夜都有 → 標成 2
          if (prev.when !== (night ? 1 : 0)) prev.when = 2;
          prev.lvMin = Math.min(prev.lvMin, s.levelMin ?? prev.lvMin);
          prev.lvMax = Math.max(prev.lvMax, s.levelMax ?? prev.lvMax);
        } else {
          merged.set(k, {
            x: rx,
            y: ry,
            when: night ? 1 : 0,
            lvMin: s.levelMin ?? 0,
            lvMax: s.levelMax ?? 0,
            tree: loc[0] > TREE_X ? 1 : 0,
          });
        }
      }
    };
    take(d.day, false);
    take(d.night, true);
    if (!merged.size) {
      none++;
      return;
    }
    // [x, y, when(0=日,1=夜,2=全天), lvMin, lvMax, world(0=主,1=世界樹)]
    spawns[key] = [...merged.values()].map((v) => [v.x, v.y, v.when, v.lvMin, v.lvMax, v.tree]);
    ok++;
  } catch (e) {
    fail++;
    if (fail <= 5) console.log(`  ${key} 失敗:${e.message}`);
  }
}

let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < keys.length) {
      const k = keys[i++];
      await one(k);
      if ((ok + none + fail) % 50 === 0) console.log(`  ${ok + none + fail}/${keys.length}`);
    }
  }),
);

const out = {
  _comment:
    "帕魯出生地。座標已由世界座標經 savToMap 換算(與玩家/標記同一套)。" +
    "每筆為 [x, y, when(0=白天,1=夜晚,2=全天), 等級下限, 等級上限, world(0=主世界,1=世界樹)]。" +
    "由 tools/fetch-pal-spawns.mjs 產生。",
  pals: spawns,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = Math.round(fs.statSync(OUT).size / 1024);
const pts = Object.values(spawns).reduce((a, v) => a + v.length, 0);
console.log(`\n有棲息地資料 ${ok} 隻、沒有 ${none} 隻、失敗 ${fail} 隻`);
console.log(`已寫入 ${path.relative(ROOT, OUT)} — ${pts} 個生成點、${kb} KB`);
