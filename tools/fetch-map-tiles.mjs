#!/usr/bin/env node
// 下載高解析地圖圖磚金字塔(z0-z6,256px,共 5461 張、約 108 MB)。
//
// 為什麼要獨立成一支腳本而不是放進版控:
// 5461 個小檔約 108 MB,放進 git 會讓每個人 clone 都背著它,而且無法反悔
// (git 歷史刪不掉)。沒有圖磚時網站會自動退回單張 4096×4096 的底圖,
// 功能完全正常,只是放到最大會糊 —— 所以這是「想要更清楚才跑」的選配。
//
// 用法(在專案根目錄):
//   node tools/fetch-map-tiles.mjs
//   node tools/fetch-map-tiles.mjs 5      # 只抓到 z5(約 30 MB,解析度減半)
//
// 跑完重新建置前端(Docker 版:docker compose up -d --build panel)。
// 已存在的檔案會跳過,中斷後重跑等於續傳。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "frontend", "packages", "web", "public", "map-tiles");
const BASE = "https://palworld.gg/images/tiles";
const MAXZ = Number(process.argv[2] ?? 6);
const CONCURRENCY = 8; // 別調高 —— 這是別人的伺服器

const jobs = [];
for (let z = 0; z <= MAXZ; z++) {
  const n = 2 ** z;
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) jobs.push({ z, x, y });
}

console.log(`下載地圖圖磚 z0-z${MAXZ},共 ${jobs.length} 張 → ${path.relative(ROOT, OUT)}`);

let done = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

async function one(job, attempt = 0) {
  const dir = path.join(OUT, String(job.z), String(job.x));
  const file = path.join(dir, `${job.y}.png`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    skipped++;
    return;
  }
  try {
    const res = await fetch(`${BASE}/${job.z}/${job.x}/${job.y}.png`, {
      headers: { Referer: "https://palworld.gg/" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    bytes += buf.length;
    done++;
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return one(job, attempt + 1);
    }
    failed++;
    if (failed <= 5) console.log(`  失敗 z${job.z}/${job.x}/${job.y}: ${e.message}`);
  }
}

let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < jobs.length) {
      await one(jobs[i++]);
      if ((done + skipped) % 500 === 0) {
        console.log(`  ${done + skipped}/${jobs.length}  (${(bytes / 1048576).toFixed(0)} MB)`);
      }
    }
  }),
);

console.log(`\n完成:新下載 ${done}、跳過 ${skipped}、失敗 ${failed}、共 ${(bytes / 1048576).toFixed(1)} MB`);
if (failed) {
  console.log("有失敗的圖磚,重跑本腳本會只補這些(已下載的會跳過)。");
  process.exitCode = 1;
}
