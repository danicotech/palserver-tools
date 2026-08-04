#!/usr/bin/env node
// 端點全面探勘:用排列組合把 op.gg 帕魯資料的 API 與 CDN 檔案掃出來。
//
// 為什麼要窮舉:先前靠「猜幾個看起來像的名字」試了三輪,每輪都只多找到
// 一兩個(fishing.json、egg-loot.json、chest-loot.json 都是這樣一個一個撿的)。
// 命名慣例其實不只一種 —— API 用 kebab-case + "-views",
// CDN 有 xxx.json、xxx-loot.json、目錄式 spawns/{key}.json 三種,
// 與其繼續猜,不如把「名稱 × 型態」整組打一遍。
//
// 用法(專案根目錄):
//   node tools/discover-endpoints.mjs            # 全掃
//   node tools/discover-endpoints.mjs --quick    # 只掃 API
// 產出 tools/endpoints-found.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tools", "endpoints-found.json");
const V = "2026080312";
const CDN = "https://s-stats-platform-cdn.op.gg/palworld/meta";
const API = "https://op.gg/zh-tw/palworld/api";
const CONCURRENCY = 6;

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
  Referer: "https://op.gg/zh-tw/palworld/map",
  Accept: "application/json",
};

/** 資料主體名稱。同一個概念的各種寫法都放進來,由排列組合去試。 */
const NAMES = [
  "pal", "pals", "paldex", "monster",
  "drop", "drops", "loot", "lottery", "reward",
  "boss", "bosses", "field-boss", "fieldBoss", "raid",
  "tower", "boss-tower", "bossTower",
  "bounty", "wanted", "predator",
  "dungeon", "dungeons", "cave",
  "chest", "chests", "element-chest", "elementChest", "treasure", "treasure-map", "treasureMap",
  "egg", "eggs", "hatch", "breeding",
  "fishing", "fish", "salvage", "junk", "supply", "meteor",
  "enemy-camp", "enemyCamp", "camp",
  "npc", "npcs", "shop", "shops", "merchant",
  "item", "items", "material", "blueprint",
  "skill", "skills", "skill-fruit", "skillFruit", "skill-fruits", "passive", "active",
  "note", "notes", "incident", "quest", "mission",
  "effigy", "relic", "lifmunk",
  "ore", "mineral", "resource", "gather",
  "region", "map", "point", "spawn", "spawns",
  "tech", "work", "food", "recipe", "build",
];

/** API 的型態 */
const API_FORMS = [(n) => `${n}-views`, (n) => `${n}-detail-views`, (n) => n, (n) => `${n}-list`];
/** CDN 的型態 */
const CDN_FORMS = [
  (n) => `${n}.json`,
  (n) => `${n}-loot.json`,
  (n) => `${n}s.json`,
  (n) => `${n}-drops.json`,
  (n) => `zh_TW/${n}_i18n.json`,
];

const quick = process.argv.includes("--quick");

/** 產生所有要試的網址,先去重(不同名稱可能組出同一個字串) */
const jobs = [];
const seen = new Set();
const add = (kind, url, label) => {
  if (seen.has(url)) return;
  seen.add(url);
  jobs.push({ kind, url, label });
};
for (const n of NAMES) {
  for (const f of API_FORMS) add("api", `${API}/${f(n)}?v=${V}`, f(n));
  if (!quick) for (const f of CDN_FORMS) add("cdn", `${CDN}/${f(n)}?v=${V}`, f(n));
}
console.log(`要試 ${jobs.length} 個網址(${quick ? "只掃 API" : "API + CDN"})`);

const found = [];
let done = 0;

/** 把 JSON 壓成一行摘要,一眼看出裡面有什麼 */
function summarize(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return { parse: false };
  }
  const top = {};
  for (const [k, v] of Object.entries(d)) {
    top[k] = Array.isArray(v) ? `[${v.length}]` : typeof v === "object" && v ? `{${Object.keys(v).length}}` : typeof v;
  }
  return { parse: true, keys: top, sample: text.slice(0, 160).replace(/\s+/g, " ") };
}

async function one(job) {
  try {
    const r = await fetch(job.url, { headers });
    if (r.status === 200) {
      const t = await r.text();
      // 有些 404 頁面也回 200 但吐 HTML,只收真的 JSON
      if (t.trim().startsWith("{") || t.trim().startsWith("[")) {
        const s = summarize(t);
        if (s.parse) {
          found.push({ ...job, bytes: t.length, ...s });
          console.log(`  ✔ ${job.kind} ${job.label.padEnd(24)} ${String(t.length).padStart(9)}  ${JSON.stringify(s.keys).slice(0, 90)}`);
        }
      }
    }
  } catch {
    /* 連不上就當作沒有 */
  }
  if (++done % 100 === 0) console.log(`  … ${done}/${jobs.length}`);
}

let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < jobs.length) await one(jobs[i++]);
  }),
);

found.sort((a, b) => b.bytes - a.bytes);
fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
console.log(`\n找到 ${found.length} 個有效端點,已寫入 ${path.relative(ROOT, OUT)}`);
for (const f of found) console.log(`  ${f.kind} ${f.label.padEnd(26)} ${String(f.bytes).padStart(9)} bytes`);
