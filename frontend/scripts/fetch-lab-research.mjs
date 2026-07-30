#!/usr/bin/env node
/**
 * 抓「公會研究(Lab Research)名稱對照表」,給公會頁標示存檔裡的
 * `research_id` / `current_research_id`(GuildExtraSaveDataMap → Lab →
 * research_info.values[].research_id,見 packages/agent/src/save-health.ts)用。
 *
 * ⚠️ 資料來源比其他 game-data 腳本特殊,請讀完再動:
 *
 *  - paldb.cc 的 `/{lang}/Pal_Labor_Research_Laboratory` 頁**沒有內部 id**——
 *    跟 Items/Pals/Humans 索引頁不同,這頁只有「顯示名稱 + 需求等級」的敘述卡片,
 *    完全沒有 `data-hover="?s=..."` 這類 anchor 可以抓 id(已用 curl 實測確認)。
 *    paldeck.cc 也**沒有**研究相關頁面(只有 /items /pals /map)。
 *  - 內部 id(存檔 research_id,例如 `EmitFlame1`、`Cool3_2`)來自
 *    **oMaN-Rod/palworld-save-pal**(一款有 Discord 社群、持續維護的存檔編輯器,
 *    UI 有完整「公會研究樹」畫面)公開在其 GitHub repo 的
 *    `data/json/lab_research.json` + `data/json/l10n/{lang}/lab_research.json`——
 *    dict key 就是研究 id,en/zh-Hant/zh-Hans 三語言檔案 168/168 筆全覆蓋
 *    (該專案自己的前端 `labResearch.svelte.ts` 也是直接拿這個 id 去對存檔查表,
 *    可信度高;但這個 repo **沒有標示授權(license: null)**,也不是
 *    paldb.cc/paldeck.cc 那種本專案維護者已取得許可的關係——commit 前請自行確認
 *    這樣引用是否 OK,見 CREDITS.md 的補充說明)。
 *  - **沒有 ja 語言**:oMaN-Rod 這個 repo 完全不支援日文(所有語言檔案都没有 ja
 *    這個 locale,不只 lab_research 缺,是整個專案都沒有)。ja 名稱改用「同名比對」
 *    從 paldb.cc 補:paldb 的 en/ja 頁是同一個模板、同一份資料庫渲染出來的兩個語言
 *    版本,168 張卡片**逐一對應**(卡片順序在同一語言站內可靠,不是跨站位置對齊)。
 *    作法:先把 paldb 卡片依「分類(Handiwork/Kindling/…)」分組並保留組內原始順序
 *    (分類名稱與筆數已驗證跟 oMaN-Rod 的 category 欄位一一對應),組內用「英文顯示名
 *    完全相同字串」去比對 oMaN-Rod 的 en 名稱——**不是**位置對齊,是先用 en 字串當
 *    橋樑鎖定同一張卡,對上才取该卡的 ja 顯示名。跑一次的結果是 167/168 命中
 *    (只有 `EmitFlame1`「Kindling Lv6」paldb 的公開清單缺這一階,查無則誠實留空,
 *    不要用位置去湊——這正是 docs/game-data-maintenance.md 記錄過的「位置對齊會誤植」
 *    踩坑,詞條 ja 才留空至今)。
 *
 * 產出:packages/web/public/game-data/research.json  [{id,name,zh?,zhCN?,ja?}]
 *      (無圖示;沿用專案 game-data 慣例:id 是存檔內部值絕不能改,zh=繁中/zhCN=簡中)
 *
 * 用法:node scripts/fetch-lab-research.mjs
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "packages/web/public/game-data");
const UA = "palserver-gui-data-sync (maintainer-approved; github.com/io-software-ai/palserver-gui)";

const PSP_RAW = "https://raw.githubusercontent.com/oMaN-Rod/palworld-save-pal/main";
const PALDB_BASE = "https://paldb.cc";

// paldb.cc 顯示分類名(英文,來自卡片副標題「<分類> Lv.N」) → oMaN-Rod lab_research.json 的 category 欄位。
// 兩邊筆數已人工核對過(22/20/18/19/18/18/19/19/15,共 168),對不上就代表 paldb 改版了,要重新核對。
const CATEGORY_MAP = {
  Handiwork: "Handcraft",
  Kindling: "EmitFlame",
  Watering: "Watering",
  Planting: "Seeding",
  "Generating Electricity": "GenerateElectricity",
  Lumbering: "Deforest",
  Mining: "Mining",
  Cooling: "Cool",
  "Medicine Production": "ProductMedicine",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/** paldb 研究頁卡片:標題(顯示名)+ 副標題(「分類 Lv.N」需求),依頁面原始順序。 */
function extractCards(html) {
  const titles = [...html.matchAll(/font-size: x-large;[^>]*>([^<]+)<\/div>/g)].map((m) => m[1].trim());
  const subs = [...html.matchAll(/<span class="me-auto"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim());
  return titles.map((t, i) => [t, subs[i]]);
}

function categoryOf(sub) {
  const m = /^(.+) Lv\.\d+$/.exec(sub ?? "");
  return m ? m[1] : null;
}

async function main() {
  // ── 1) 內部 id + en/zh/zhCN(oMaN-Rod/palworld-save-pal,168 筆整份) ──
  const [base, en, zhHant, zhHans] = await Promise.all([
    getJson(`${PSP_RAW}/data/json/lab_research.json`),
    getJson(`${PSP_RAW}/data/json/l10n/en/lab_research.json`),
    getJson(`${PSP_RAW}/data/json/l10n/zh-Hant/lab_research.json`),
    getJson(`${PSP_RAW}/data/json/l10n/zh-Hans/lab_research.json`),
  ]);

  const ids = Object.keys(base);

  // 依 category 分組,保留 dict 原始順序(等一下跟 paldb 同分類的卡片群做 en 名稱比對)。
  const idsByCategory = new Map();
  for (const id of ids) {
    const cat = base[id].category;
    if (!idsByCategory.has(cat)) idsByCategory.set(cat, []);
    idsByCategory.get(cat).push(id);
  }

  // ── 2) ja 名稱:paldb.cc en/ja 研究頁,168 張卡片語言版本一一對應,
  //      用「en 顯示名字串完全相同」在同分類卡片群裡鎖定對應的 ja 卡。 ──
  const enHtml = await getText(`${PALDB_BASE}/en/Pal_Labor_Research_Laboratory`);
  await sleep(400);
  const jaHtml = await getText(`${PALDB_BASE}/ja/Pal_Labor_Research_Laboratory`);

  const enCards = extractCards(enHtml);
  const jaCards = extractCards(jaHtml);
  if (enCards.length !== jaCards.length) {
    console.warn(`警告:paldb en(${enCards.length})/ja(${jaCards.length}) 卡片數不一致,ja 比對可能不準`);
  }

  // 依 paldb 顯示分類(對映到 oMaN-Rod category)分組,組內保留頁面原始順序。
  const paldbByCategory = new Map();
  for (let i = 0; i < enCards.length; i++) {
    const [enTitle, enSub] = enCards[i];
    const [jaTitle] = jaCards[i] ?? [];
    const displayCat = categoryOf(enSub);
    const cat = CATEGORY_MAP[displayCat];
    if (!cat) continue; // 分類名稱比對不到就跳過(不硬湊)
    if (!paldbByCategory.has(cat)) paldbByCategory.set(cat, []);
    paldbByCategory.get(cat).push({ enTitle, jaTitle });
  }

  const jaById = new Map();
  for (const [cat, catIds] of idsByCategory) {
    // 同分類卡片群,依「en 名稱字串」做佇列消費比對(同名可能重複出現,先進先出對應)。
    const nameQueue = new Map(); // enTitle -> array of jaTitle
    for (const { enTitle, jaTitle } of paldbByCategory.get(cat) ?? []) {
      if (!nameQueue.has(enTitle)) nameQueue.set(enTitle, []);
      nameQueue.get(enTitle).push(jaTitle);
    }
    for (const id of catIds) {
      const enName = en[id]?.localized_name;
      const queue = nameQueue.get(enName);
      if (queue && queue.length > 0) {
        const ja = queue.shift();
        if (ja) jaById.set(id, ja);
      }
    }
  }

  // ── 3) 組裝輸出,依 id 排序(方便 diff) ──
  const research = ids
    .map((id) => {
      const name = en[id]?.localized_name;
      const zh = zhHant[id]?.localized_name;
      const zhCN = zhHans[id]?.localized_name;
      const ja = jaById.get(id);
      return {
        id,
        name: name ?? id,
        ...(zh ? { zh } : {}),
        ...(zhCN ? { zhCN } : {}),
        ...(ja ? { ja } : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  await writeFile(path.join(DATA_DIR, "research.json"), JSON.stringify(research) + "\n");

  // ── 統計 ──
  const zhCount = research.filter((r) => r.zh).length;
  const zhCNCount = research.filter((r) => r.zhCN).length;
  const jaCount = research.filter((r) => r.ja).length;
  console.log(
    `research.json: ${research.length} 筆(zh ${zhCount};zhCN ${zhCNCount};ja ${jaCount}/${research.length}）`,
  );
  const missingJa = research.filter((r) => !r.ja).map((r) => r.id);
  if (missingJa.length > 0) console.log(`ja 查無(誠實留空):${missingJa.join(", ")}`);
}

await main();
