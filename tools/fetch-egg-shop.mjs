#!/usr/bin/env node
// 產生「蛋」與「NPC 商店」的面板資料,併入 map-panel.json。
//
// 這兩類不走 map-detail-views(那支對它們一律回 null),資料在 CDN:
//   meta/egg-loot.json  14 個蛋池,每池是「孵得到哪些帕魯 + 機率 + 冷卻時間」
//   meta/shops.json     38 間商店的商品與售價(品名要用 shop-views 補中文)
//
// 蛋的座標對應:points.json 的 Eggs 有 k 欄位(grass_01、volcano_02…),
// 正好就是蛋池的鍵,直接對得上。
// 商店沒有座標,但 points.json 的 NPC 代號(第 5 欄)和 shops.json 的 id
// 命名一致,可以一對一接起來:MedalTrader→Medal_Shop_1、
// SalesPerson_Volcano2→Volcano_Shop_2、Head_of_Village→Village_Shop_1…
// 這比用中文分類名去猜精準得多(先前只敢接三家,現在能接十家)。
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
const npcViews = await getJson(`${API}/npc-detail-views?v=${V}`);

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
    // 存帕魯代號而不是蛋的圖示代號 —— 玩家要看的是「孵出哪一隻」,
    // 十幾種帕魯配同一張蛋圖完全分不出差別。前端用 pal 去查帕魯頭像。
    .map((e) => ({ n: palName(e.pal), pal: e.pal, q: 1, r: e.rate }));
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

/** NPC 代號 → 商店 id。兩邊的命名幾乎一一對應,列出來比寫規則清楚,
 *  也方便日後對照來源檢查。沒列到的(DarkTrader 黑市、PalDealer 帕魯商人)
 *  在 shops.json 裡本來就沒有對應商店 —— 他們賣的不是一般商品。
 *  流動商販 Vagrant_Trader 與商隊 Caravan_Shop 沒有固定座標,也接不上。 */
const NPC_SHOP = {
  MedalTrader: "Medal_Shop_1",
  BountyTrader: "Bounty_Shop_1",
  SalesPerson: "Wander_Shop_1",
  SalesPerson_Volcano: "Volcano_Shop_1",
  SalesPerson_Volcano2: "Volcano_Shop_2",
  SalesPerson_Desert: "Desert_Shop_1",
  SalesPerson_Desert2: "Desert_Shop_2",
  Head_of_Village: "Village_Shop_1",
  NPC_Dungeon_Shop: "Dungeon_Shop_01",
  ArenaShop: "Arena_Shop_1",
};

// ── 帕魯商人 / 黑市商人 ────────────────────────────────────────────
// 他們賣的是帕魯不是商品,所以不在 shops.json 裡,而在 npc-detail-views:
//   pal-shop:Test_01(Lv. 5–10、47 隻)、pal-shop:Dark_03(Lv. 42–48、8 隻)…
// 對應方式:先用代號分流(PalDealer_Desert → Desert_00),
// 一般的 PalDealer / DarkTrader 再用「標記等級落在哪個區間」去比對 ——
// 資料裡的等級剛好都落在某一段內(PalDealer Lv7→5–10、Lv11–14→10–15、
// DarkTrader Lv43–47→42–48、DarkTrader03 Lv54→50–55)。
const palShops = [];
for (const d of npcViews.details ?? []) {
  if (!d.id?.startsWith("pal-shop:")) continue;
  const sec = d.sections?.[0];
  const pals = sec?.pals ?? [];
  if (!pals.length) continue;
  const m = /(\d+)\s*[–-]\s*(\d+)/.exec(sec.label ?? "");
  palShops.push({
    id: d.id.slice("pal-shop:".length),
    l: d.label,
    lv: m ? [Number(m[1]), Number(m[2])] : undefined,
    items: pals.map((x) => ({ n: x.name, pal: x.id, q: `Lv.${x.minLevel}–${x.maxLevel}` })),
  });
}

// ── 其餘 NPC:帕魯評論家 / 愛的傳教士 / 帕魯馴養師 ──────────────────
// 這三類的資料同樣在 npc-detail-views,但欄位名各不相同 ——
// requests(要求帶哪隻帕魯來 → 給什麼獎勵)、rewards(依地區的獎勵池)、
// achievements(達成幾次 → 給什麼)。我先前只看 pals / items 兩個欄位,
// 三類全都被當成「沒有資料」。
const rw = (list) =>
  (list ?? []).slice(0, 30).map((r) => ({
    n: r.name,
    i: r.iconName,
    q: r.minQty === r.maxQty ? r.minQty : `${r.minQty}–${r.maxQty}`,
    r: r.rate,
  }));

const npcDetails = {};
for (const d of npcViews.details ?? []) {
  if (d.id?.startsWith("pal-shop:")) continue;
  const groups = [];
  for (const sec of d.sections ?? []) {
    // 帕魯評論家:一筆委託 = 帶指定帕魯去 → 換一組獎勵
    for (const q of sec.requests ?? []) {
      groups.push({
        l: `${sec.label} · ${q.pal?.name ?? ""}`,
        pal: q.pal?.id,
        items: rw(q.rewards),
      });
    }
    // 帕魯馴養師:達成 N 次 → 獎勵
    for (const a of sec.achievements ?? []) {
      groups.push({ l: `${sec.label} ×${a.requireCount}`, items: rw(a.rewards) });
    }
    // 愛的傳教士:依地區的獎勵池
    if (sec.rewards?.length && !sec.requests && !sec.achievements) {
      groups.push({ l: sec.label, items: rw(sec.rewards) });
    }
  }
  if (groups.length) npcDetails[d.id] = { l: d.label, g: groups.filter((g) => g.items.length) };
}

// ── 併入既有的 map-panel.json ────────────────────────────────────
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { panels: {}, at: {} };
prev.panels.egg = eggPanels;
prev.at = { ...prev.at, ...at };
prev.shops = shops;
prev.shopByNpc = NPC_SHOP;
prev.palShops = palShops;
prev.npcDetails = npcDetails;
// NPC 代號 → npcDetails 的鍵。評論家的 A_01…I_01 剛好對上 A1…I1;
// 愛的傳教士 17 個點共用同一份(來源就叫 all,沒有分點的資料)。
prev.npcDetailByCode = {
  Presenter001: "achievement-reward:Presenter001",
  ...Object.fromEntries(
    "ABCDEFGHI".split("").map((c) => [`U_Reward_PalDisplay_${c}_01`, `pal-display:${c}1`]),
  ),
};
// 代號前綴 → 帕魯商店 id;沒列到的用等級區間比對
prev.palShopByCode = { PalDealer_Desert: "Desert_00", PalDealer_Volcano: "Volcano_00" };
prev.version = V;
fs.writeFileSync(OUT, JSON.stringify(prev));

console.log(`
  蛋池     ${Object.keys(eggPanels).length} 種 → 對上 ${eggHit} 個座標(沒對上 ${eggMiss} 個)
  商店     ${shops.length} 間、品項 ${shops.reduce((a, s) => a + s.items.length, 0)} 個
  接到 NPC ${Object.keys(NPC_SHOP).length} 家(其餘沒有固定座標或本來就沒商店)
  帕魯商店 ${palShops.length} 家、共 ${palShops.reduce((a, s) => a + s.items.length, 0)} 隻帕魯
  其他 NPC ${Object.keys(npcDetails).length} 筆(評論家委託 / 傳教士獎勵 / 馴養師成就)
已寫入 ${path.relative(ROOT, OUT)} — ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
