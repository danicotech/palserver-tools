// 詞條 / 技能分類（供「詞條查詢」以 Tier 分層表方式呈現）。
// 被動詞條：人工歸類（curated name → 類別）；主動技能：依名稱關鍵字判屬性。

export interface TraitCat {
  key: string;
  label: string;
  color: string; // 分層標籤底色（HEX）
}

/* ---------------- 被動詞條 ---------------- */
export const PASSIVE_CATS: TraitCat[] = [
  { key: "legend", label: "傳說・帝王", color: "#a855f7" },
  { key: "atk", label: "攻擊強化", color: "#ef4444" },
  { key: "def", label: "防禦・生存", color: "#3b82f6" },
  { key: "work", label: "工作・採集", color: "#22c55e" },
  { key: "move", label: "移動・敏捷", color: "#06b6d4" },
  { key: "elem", label: "屬性・晝夜", color: "#f59e0b" },
  { key: "mind", label: "精神・增益", color: "#14b8a6" },
  { key: "neg", label: "負面・怪癖", color: "#64748b" },
  { key: "other", label: "其他", color: "#94a3b8" },
];

const PASSIVE_GROUPS: Record<string, string[]> = {
  legend: [
    "傳說", "稀有", "未知生物細胞", "龍之血脈", "神龍", "冥王", "海皇", "精靈王",
    "聖天", "巖帝", "冰帝", "雷帝", "永炎", "救世主", "侵略者", "神樹苗床",
    "湖之主", "炎帝", "魔女", "礦山首領", "突襲指揮官",
  ],
  atk: ["兇猛", "卓絕技藝", "粗暴", "強勢", "屠龍者", "大地之力", "破浪王者", "一反常態", "毀滅慾望"],
  def: [
    "堅硬皮膚", "頑強肉體", "抗震結構", "絕緣體", "防水性能", "金剛之軀",
    "不死之身", "重裝甲", "健康寶寶", "特殊體質", "高貴",
  ],
  work: [
    "工匠精神", "採伐領袖", "牧場之子", "牧場之主", "裝填大師", "防過勞幫手",
    "節食大師", "療癒教練", "工作狂", "除草效果", "鐵壁軍師", "手下留情", "寶寶保母",
  ],
  move: ["神速", "運動健將", "游泳健將", "靈活", "凌空微步", "身輕如燕", "悠然泳姿", "啦啦隊"],
  elem: [
    "喜歡玩火", "高溫體質", "電容", "冷血", "陽光開朗", "擁抱烈日", "喜歡戲水",
    "草木馨香", "夜幕", "夜行性", "夜貓子", "禪境",
  ],
  mind: [
    "無限精力", "奉獻精神", "積極思維", "明鏡止水", "沉著冷靜", "認真", "勇敢",
    "慷慨就義", "博愛主義者", "腦筋", "貴族",
  ],
  neg: [
    "膽小", "急性子", "慢性子", "家裡蹲", "偷懶成癮", "笨手笨腳", "情緒不穩",
    "消極主義者", "弱不禁風", "骨質疏鬆", "小胃", "寒酸", "受虐狂", "虐待狂",
    "自戀狂", "無底之胃", "貪吃", "極限絕食", "鬼神",
  ],
};

const PASSIVE_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, arr] of Object.entries(PASSIVE_GROUPS)) for (const name of arr) m[name] = k;
  return m;
})();

export function passiveCat(name: string): string {
  return PASSIVE_MAP[name] ?? "other";
}

/* ---------------- 主動技能（依屬性） ---------------- */
export const SKILL_CATS: TraitCat[] = [
  { key: "fire", label: "🔥 火焰", color: "#ef4444" },
  { key: "water", label: "💧 水", color: "#3b82f6" },
  { key: "ice", label: "❄️ 冰霜", color: "#38bdf8" },
  { key: "thunder", label: "⚡ 雷電", color: "#eab308" },
  { key: "grass", label: "🌿 草・自然", color: "#22c55e" },
  { key: "dragon", label: "🐉 龍", color: "#8b5cf6" },
  { key: "dark", label: "🌑 暗黑", color: "#4b5563" },
  { key: "ground", label: "⛰️ 地・岩", color: "#a16207" },
  { key: "normal", label: "⚪ 一般・其他", color: "#94a3b8" },
];

// 少數會被關鍵字誤判者的手動修正。
const SKILL_OVERRIDE: Record<string, string> = {
  龍捲風: "normal", // 名含「龍」但實為風/一般
};

// 判斷順序（先符合先歸類）。
const SKILL_RULES: { key: string; kw: string[] }[] = [
  { key: "dragon", kw: ["龍"] },
  { key: "dark", kw: ["暗", "惡夢", "噩夢", "黑暗", "幽", "竊魂", "怨念", "墨", "陰雲", "天變", "黑天鵝", "毒", "惡之", "召喚僕從"] },
  { key: "thunder", kw: ["雷", "電", "閃", "伏特", "並聯", "霹靂"] },
  { key: "ice", kw: ["冰", "凜冬", "霜", "寒", "凍", "雪", "急凍"] },
  { key: "fire", kw: ["烈焰", "火", "炎", "熔岩", "焚", "熾", "岩漿", "鳳凰", "獄火", "三相"] },
  { key: "grass", kw: ["草", "種子", "葉", "孢子", "花粉", "蓮華", "綠野", "滾草", "根鬚", "纏根", "豐饒", "巨大孢子"] },
  { key: "ground", kw: ["岩", "巖", "地", "沙塵", "碎石", "碎岩", "泥", "掘地", "鐵山", "山靠", "粉碎大地", "巨石", "聖石", "震", "投石"] },
  { key: "water", kw: ["水", "泡", "瀑", "潮", "浪", "漩渦", "渦", "波濤", "鯨", "海", "汪", "枯鬚", "分流", "斷海", "凌波"] },
];

export function skillCat(name: string): string {
  if (SKILL_OVERRIDE[name]) return SKILL_OVERRIDE[name];
  for (const r of SKILL_RULES) if (r.kw.some((k) => name.includes(k))) return r.key;
  return "normal";
}
