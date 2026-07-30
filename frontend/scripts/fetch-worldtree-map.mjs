#!/usr/bin/env node
/**
 * 抓 paldb.cc 的世界樹(The World Tree)底圖 tile,拼成單張 4096² webp,
 * 供線上地圖第二張底圖用(維護者為 paldb.cc 貢獻者,已獲同意抓取;
 * 見 packages/web/public/game-data/CREDITS.md)。
 *
 * 座標校正:圖的四角 = treemap_data_en.js 的 landScapeRealPositionMin/Max
 * (X∈[347351.5, 689148.5], Y∈[-818197, -476400]),轉換公式在
 * packages/shared/src/index.ts 的 savToWorldTreeMap;研究依據
 * .claude/notes/worldtree-map-research.md。
 *
 * 用法:node scripts/fetch-worldtree-map.mjs
 * (依賴 website/node_modules 的 sharp;遊戲改版底圖更新時重跑一次再 commit)
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(path.join(ROOT, "website", "package.json"))("sharp");

const ZOOM = 3; // 8×8 tiles × 512px = 4096²,與主世界底圖同解析度
const N = 2 ** ZOOM;
const TILE = 512;
const OUT = path.join(ROOT, "packages/web/public/worldtree-map.webp");
const UA = "palserver-gui-data-sync (maintainer-approved; github.com/io-software-ai/palserver-gui)";

async function fetchTile(x, y) {
  const url = `https://cdn.paldb.cc/image/treemap8/z${ZOOM}x${x}y${y}.webp`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://paldb.cc/en/The_World_Tree" },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const composites = [];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const buf = await fetchTile(x, y);
    composites.push({ input: buf, left: x * TILE, top: y * TILE });
    process.stdout.write(`\rtiles ${composites.length}/${N * N}`);
  }
}
console.log();

const img = await sharp({
  create: { width: N * TILE, height: N * TILE, channels: 3, background: { r: 6, g: 22, b: 38 } },
})
  .composite(composites)
  .webp({ quality: 80 })
  .toBuffer();
await writeFile(OUT, img);
console.log(`寫入 ${OUT}(${(img.length / 1024 / 1024).toFixed(2)} MB, ${N * TILE}²)`);
