// 產生配種表 UI 用的帕魯靜態中繼資料(屬性/圖鑑編號/稀有度):
//   node scripts/fetch-pal-meta.mjs
// 來源:oMaN-Rod/palworld-save-pal 的 data/json/pals.json(element_types / rarity /
// pal_deck_index,鍵與 palcalc breeding.json 的 InternalName 同一命名空間)。
// 只收 breeding.json 出現的物種,輸出精簡格式壓在 ~10KB。
import fs from "node:fs/promises";
import path from "node:path";

const SRC = "https://raw.githubusercontent.com/oMaN-Rod/palworld-save-pal/main/data/json/pals.json";
const breedingPath = path.resolve("packages/web/public/game-data/breeding.json");
const out = path.resolve("packages/web/public/game-data/pal-meta.json");

// element_types 英文名 → 面板慣用繁中屬性字(panel/ui.tsx ELEMENT_COLORS 的鍵)
const EL = {
  Fire: "火",
  Water: "水",
  Grass: "草",
  Leaf: "草",
  Electric: "雷",
  Electricity: "雷",
  Thunder: "雷",
  Ice: "冰",
  Dragon: "龍",
  Dark: "暗",
  Earth: "地",
  Ground: "地",
  Neutral: "無",
  Normal: "無",
};

const breeding = JSON.parse(await fs.readFile(breedingPath, "utf8"));
const species = new Set();
for (const [p1, , p2, , child] of breeding.recipes) {
  species.add(p1);
  species.add(p2);
  species.add(child);
}

const response = await fetch(SRC);
if (!response.ok) throw new Error(`pals.json: HTTP ${response.status}`);
const all = await response.json();

// 鍵大小寫寬鬆對照(save-pal 的鍵偶有大小寫差異)
const byLower = new Map(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));

const meta = {};
const missing = [];
for (const id of [...species].sort()) {
  const row = all[id] ?? byLower.get(id.toLowerCase());
  if (!row) {
    missing.push(id);
    continue;
  }
  const el = (row.element_types ?? []).map((e) => EL[e] ?? e);
  meta[id] = { el, deck: row.pal_deck_index ?? 0, r: row.rarity ?? 0 };
}

await fs.writeFile(out, JSON.stringify(meta));
console.log(`Wrote ${Object.keys(meta).length}/${species.size} species to ${out}`);
if (missing.length) console.log("missing:", missing.join(", "));
