#!/usr/bin/env node
// 下載詳細面板要用的道具圖示。
//
// 面板的掉落表每一項都帶 iconName(DogCoin、Blueprint…),
// 圖檔在 op.gg 的 CDN:palworld/images/icons/<iconName>.webp。
// 要下載到本機而不是直接連對方的圖:一來對方隨時可能擋外連,
// 二來每開一次面板就對外拉十幾張圖,慢且不禮貌。
//
// 需要哪些圖是從 map-panel.json / map-detail.json 掃出來的,
// 不是寫死清單 —— 資料更新後重跑就會自動補齊。
//
// 用法(專案根目錄):node tools/fetch-item-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const DIR = path.join(WEB, "item-icons");
const NOTE_DIR = path.join(WEB, "note-images");
const BASE = "https://s-stats-platform-cdn.op.gg/palworld/images/icons";
const NOTE_BASE = "https://s-stats-platform-cdn.op.gg/palworld/images/notes";
const CONCURRENCY = 6;

fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(NOTE_DIR, { recursive: true });

/** 從已產生的資料檔裡掃出所有 iconName */
const names = new Set();
for (const f of ["map-panel.json", "map-detail.json"]) {
  const p = path.join(WEB, f);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, "utf8");
  for (const m of txt.matchAll(/"(?:i|curIcon)":"([A-Za-z0-9_\-.]+)"/g)) names.add(m[1]);
}
const list = [...names].filter(Boolean).sort();
console.log(`需要 ${list.length} 種圖示`);

const headers = { "User-Agent": "Mozilla/5.0 Chrome/131.0", Referer: "https://op.gg/" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0;
let have = 0;
let miss = 0;
let i = 0;

async function one(name) {
  const out = path.join(DIR, `${name}.webp`);
  if (fs.existsSync(out) && fs.statSync(out).size > 200) {
    have++;
    return;
  }
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`${BASE}/${name}.webp`, { headers });
      if (r.status === 404) {
        miss++;
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) throw new Error("檔案太小");
      fs.writeFileSync(out, buf);
      ok++;
      return;
    } catch {
      await sleep(500 * (t + 1));
    }
  }
  miss++;
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < list.length) {
      const n = list[i++];
      await one(n);
      if ((ok + have + miss) % 60 === 0) console.log(`  ${ok + have + miss}/${list.length}`);
    }
  }),
);

// ── 筆記的掃描圖 ──────────────────────────────────────────────
// 和道具圖示不同目錄、不同來源,但抓法一樣:從資料檔掃出 textureName。
const noteNames = new Set();
{
  const p = path.join(WEB, "map-detail.json");
  if (fs.existsSync(p)) {
    for (const m of fs.readFileSync(p, "utf8").matchAll(/"img":"([A-Za-z0-9_\-.]+)"/g)) noteNames.add(m[1]);
  }
}
let nOk = 0;
let nSkip = 0;
if (noteNames.size) {
  console.log(`
筆記掃描圖 ${noteNames.size} 張`);
  const list2 = [...noteNames];
  let j = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (j < list2.length) {
        const name = list2[j++];
        const out = path.join(NOTE_DIR, `${name}.webp`);
        if (fs.existsSync(out) && fs.statSync(out).size > 200) { nSkip++; continue; }
        try {
          const r = await fetch(`${NOTE_BASE}/${name}.webp`, { headers });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 200) { fs.writeFileSync(out, buf); nOk++; }
        } catch {
          /* 抓不到就算了,面板會退回只顯示文字 */
        }
      }
    }),
  );
  console.log(`  新下載 ${nOk}、已有 ${nSkip}`);
}

const total = fs.readdirSync(DIR).length;
const kb = fs
  .readdirSync(DIR)
  .reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
console.log(`\n新下載 ${ok}、已有 ${have}、抓不到 ${miss}`);
console.log(`${path.relative(ROOT, DIR)} 共 ${total} 張、${Math.round(kb / 1024)} KB`);
