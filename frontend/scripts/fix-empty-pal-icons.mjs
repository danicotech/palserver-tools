#!/usr/bin/env node
/**
 * 修復 0-byte 的帕魯圖示:掃 public/game-data/pals/ 裡空的圖檔,從 paldb.cc
 * 的 Pals 索引頁重新下載(與 fetch-human-npcs.mjs 同一來源與 UA 慣例;
 * 來源授權見 public/game-data/CREDITS.md)。可重跑:沒有空檔就不做事。
 *
 * 背景:2026-07-10 首次下載時有 14 張(1.0/新世代帕魯)靜默寫成空檔,
 * 造成傑諾貝達(DarkAlien)等在 UI 顯示不出頭像。
 */
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PALS_DIR = path.join(ROOT, "packages/web/public/game-data/pals");
const UA = "palserver-gui-data-sync (maintainer-approved; github.com/io-software-ai/palserver-gui)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

async function main() {
  const empty = [];
  for (const f of await readdir(PALS_DIR)) {
    if ((await stat(path.join(PALS_DIR, f))).size === 0) empty.push(f);
  }
  if (empty.length === 0) {
    console.log("沒有空的圖檔,不需修復。");
    return;
  }
  console.log(`空圖檔 ${empty.length} 個:`, empty.join(", "));

  // paldb 的 Pals 索引頁:卡片 <img src> 的檔名與我們的 icon 檔名一致
  const html = await (await get("https://paldb.cc/en/Pals")).text();
  const urls = new Map();
  for (const [, url] of html.matchAll(/<img loading="lazy" src="([^"]+)"/g)) {
    urls.set(path.basename(url), url);
  }

  let fixed = 0;
  for (const f of empty) {
    // 索引頁可能用 .webp 服務同名圖;兩種副檔名都試
    const cand = [f, f.replace(/\.png$/, ".webp"), f.replace(/\.webp$/, ".png")];
    const url = cand.map((c) => urls.get(c)).find(Boolean);
    if (!url) {
      console.warn(`  找不到來源:${f}`);
      continue;
    }
    const res = await get(url.startsWith("http") ? url : `https://paldb.cc${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      console.warn(`  來源也是空的:${f}`);
      continue;
    }
    await writeFile(path.join(PALS_DIR, f), buf);
    fixed += 1;
    console.log(`  修復 ${f}(${buf.length} bytes)`);
    await sleep(400);
  }
  console.log(`完成:${fixed}/${empty.length}`);
  if (fixed < empty.length) process.exitCode = 1;
}

await main();
