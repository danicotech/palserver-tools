#!/usr/bin/env node
// 產生「蛋」與「NPC 商店」的面板資料,併入 map-panel.json。
//
// 這兩類不走 map-detail-views(那支對它們一律回 null),資料在 CDN:
//   meta/egg-loot.json  14 個蛋池,每池是「孵得到哪些帕魯 + 機率 + 冷卻時間」
//   meta/shops.json     38 間商店的商品與售價(品名要用 shop-views 補中文)
//
// 蛋的座標對應:points.json 的 Eggs 有 k 欄位(grass_01、volcano_02…),
// 正好就是蛋池的鍵,直接對得上。
// 商店沒有座標,只能靠「商店數量與 NPC 數量」推不出對應關係,
// 所以商店資料獨立成一份清單,由前端在 NPC 面板上以列表呈現。
//
// 用法(專案根目錄):node tools/fetch-egg-shop.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend", "packages", "web", "public", "game-data");
const OUT = path.join(WEB, "map-panel.json");
const V = process.argv[2] ?? "2026080401";
const CDN = "https://s-stats-platform-cdn.op.gg/palworld/meta";
const API = "https://op.gg/zh-tw/palworld/api";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
  Referer: "https://op.gg/zh-tw/palworld/map",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 併發抓五支時偶爾會踩到解壓錯誤(Z_DATA_ERROR),重試一下就好;
// 所以下面也改成逐一抓,而不是 Promise.all。
const getJson = async (u, retry = 8) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= retry) throw new Error(`${u} → ${e.message}`);
      await sleep(1200 * (i + 1));
    }
  }
};

const WORLD_OFFSET = { northSouth: 123888, eastWest: -158000 };
const WORLD_SCALE = 459;
const savToMap = (sx, sy) => ({
  x: (sy + WORLD_OFFSET.eastWest) / WORLD_SCALE,
  y: (sx + WORLD_OFFSET.northSouth) / WORLD_SCALE,
});

console.log("抓取蛋池、商店與帕魯名稱…");
// 蛋的座標直接用本機已產生的 map-points.json ——
// 它的第 5 欄就是原始的 k 值(grass_01…),不必再抓 720 KB 的 points.json,
// 而且那支用新版本號會連線中斷(舊版本號才有快取)。
const localPts = JSON.parse(fs.readFileSync(path.join(WEB, "map-points.json"), "utf8"));
const i18n = await getJson(`${CDN}/zh_TW/points_i18n.json?v=2026080312`);
const eggs = await getJson(`${CDN}/egg-loot.json?v=2026080312`);
const shopsRaw = await getJson(`${CDN}/shops.json?v=2026080312`);
const shopViews = await getJson(`${API}/shop-views?v=${V}`);

/** 帕魯代號 → 中文名。points_i18n 的 pal 命名空間就有,不必另外抓。 */
const palName = (k) => i18n.pal?.[k] ?? k;

// ── 蛋 ────────────────────────────────────────────────────────────
// 每個蛋池列出孵得到的帕魯與機率;機率低的長尾砍掉,面板放不下也沒人看。
const eggPanels = {};
for (const [poolKey, pool] of Object.entries(eggs.pools ?? {})) {
  const items = (pool.entries ?? [])
    .slice()
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 30)
    .map((e) => ({ n: palName(e.pal), i: e.egg, q: 1, r: e.rate }));
  if (!items.length) continue;
  eggPanels[poolKey] = {
    // 不給標題:提示第一行已經是分類名(草原蛋 15),再寫「帕魯蛋」只是重複
    t: undefined,
    d: pool.cooldownMinutes ? `重生時間 ${pool.cooldownMinutes} 分鐘` : undefined,
    g: [{ l: "可能孵出", items }],
  };
}

// 座標索引:Eggs 的 k 欄位(grass_01)就是蛋池的鍵
const at = {};
let eggHit = 0;
let eggMiss = 0;
for (const [cat, rows] of Object.entries(localPts.points)) {
  if (!cat.startsWith("Eggs")) continue;
  for (const r of rows) {
    const k = typeof r[4] === "string" ? r[4] : "";
    const pool = eggPanels[k] ? k : Object.keys(eggPanels).find((x) => k.startsWith(x));
    if (pool) {
      at[`${Math.round(r[0])},${Math.round(r[1])}`] = ["egg", pool];
      eggHit++;
    } else eggMiss++;
  }
}

// ── 商店 ──────────────────────────────────────────────────────────
// shops.json 有售價與數量但品名是代號;shop-views 有中文品名。兩邊按順序對齊。
const zhShops = shopViews.shops ?? [];
const shops = (shopsRaw.shops ?? []).map((s, i) => {
  const zh = zhShops[i];
  const items = (s.products ?? []).map((p, j) => {
    const z = zh?.items?.[j];
    return { n: z?.name ?? p.id, i: z?.iconName, q: p.num, p: p.price, once: p.once || undefined };
  });
  return { id: s.id, l: zh?.label ?? s.id, cur: zh?.currencyName ?? s.currency, items };
});

// ── 併入既有的 map-panel.json ────────────────────────────────────
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { panels: {}, at: {} };
prev.panels.egg = eggPanels;
prev.at = { ...prev.at, ...at };
prev.shops = shops;
prev.version = V;
fs.writeFileSync(OUT, JSON.stringify(prev));

console.log(`
  蛋池     ${Object.keys(eggPanels).length} 種 → 對上 ${eggHit} 個座標(沒對上 ${eggMiss} 個)
  商店     ${shops.length} 間、品項 ${shops.reduce((a, s) => a + s.items.length, 0)} 個
已寫入 ${path.relative(ROOT, OUT)} — ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
