// 點擊地圖標記後彈出的右側詳細面板。
//
// 為什麼要獨立成面板而不是塞進滑鼠提示:提示只能放三四行,
// 但藏寶圖有 5 組、每組三十幾項,寶箱與頭目也都有完整掉落表。
// 提示負責「這是什麼」,面板負責「裡面有什麼」。
import type { JSX } from "react";
import { FiX, FiEye, FiEyeOff } from "react-icons/fi";
import {
  panelKindOf,
  detailKey,
  INCIDENT_CATEGORY,
  NOTE_CATEGORY,
  type MapDetail,
  type MapPanel,
  type DetailItem,
} from "./mapPoints";
import { t } from "../i18n";

/** 面板要顯示的一組品項 */
interface Group {
  label: string;
  items: DetailItem[];
}

export interface Selection {
  cat: string;
  label: string;
  idx: number;
  x: number;
  y: number;
  z: number;
  name: string;
  lv: number | string;
  sub: string;
  collectable: boolean;
}

const ICON = (name?: string) => (name ? `/game-data/item-icons/${name}.webp` : null);

/** 容差一格的座標查表。兩邊座標各自四捨五入過,整數邊界上會差一格。 */
function near<T>(table: Record<string, T> | undefined, x: number, y: number): T | undefined {
  if (!table) return undefined;
  const exact = table[detailKey(x, y)];
  if (exact !== undefined) return exact;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const v = table[detailKey(x + dx, y + dy)];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** 蒐集這個標記能顯示的所有內容:副標題、說明、分組品項。 */
function contentOf(
  sel: Selection,
  detail: MapDetail | null,
  panel: MapPanel | null,
): { title: string; sub?: string; desc?: string; groups: Group[] } {
  const groups: Group[] = [];
  let title = sel.name || sel.label;
  let sub: string | undefined;
  let desc: string | undefined;

  // map-panel:頭目 / 釣場 / 地牢 / 打撈 / 隕石 / 組織之塔 / 古代遺跡 / 藏寶圖 / 蛋
  // 一定要比對 kind —— 查表有容差,不比對會抓到隔壁別類標記的資料。
  const want = panelKindOf(sel.cat);
  const pk = panel && want ? near(panel.at, sel.x, sel.y) : undefined;
  if (pk && pk[0] === want) {
    const rec = panel?.panels?.[pk[0]]?.[pk[1]];
    if (rec) {
      if (rec.t) title = rec.t;
      if (rec.s) sub = rec.s;
      if (rec.d) desc = rec.d;
      for (const g of rec.g ?? []) if (g.items.length) groups.push({ label: g.l || t("掉落物"), items: g.items });
    }
  }

  // 寶箱與屬性寶箱:掉落表在 chest-views(屬性寶箱的類別代號不是 Chest 開頭)
  if (!groups.length && (sel.cat.startsWith("Chestbox") || sel.cat === "ElementTreasure")) {
    const slug = near(detail?.chestAt, sel.x, sel.y);
    const c = slug ? detail?.chests?.[slug] : undefined;
    if (c) {
      title = c.l;
      for (const g of c.g) if (g.items.length) groups.push({ label: `${t("品階")} ${g.grade}`, items: g.items });
    }
  }

  // 技能果實樹:依屬性分成九組
  if (!groups.length && sel.cat === "SkillFruits") {
    const slug = near(detail?.fruitAt, sel.x, sel.y);
    const f = slug ? detail?.skillFruit?.[slug] : undefined;
    if (f) {
      title = f.l;
      for (const g of f.g) if (g.items.length) groups.push({ label: g.l || g.el || "", items: g.items });
    }
  }

  // 事件:同一個生成點會隨機刷出多種,列出全部標題與分類
  if (sel.cat === "Incident") {
    const ids = near(detail?.incidentAt, sel.x, sel.y);
    if (ids?.length && detail) {
      title = t("事件");
      sub = `${ids.length} ${t("種")}`;
      groups.push({
        label: t("可能發生的事件"),
        items: ids
          .map((i) => detail.incidents[i])
          .filter(Boolean)
          .map((e) => ({ n: e.t, q: INCIDENT_CATEGORY[e.c] ?? e.c, r: undefined })),
      });
    }
  }

  // 筆記:面板才是讀全文的地方,提示只放標題
  if (sel.cat === "Note" && sel.sub) {
    const n = detail?.notes?.[sel.sub];
    if (n) {
      title = n.t;
      sub = NOTE_CATEGORY[n.c] ?? n.c;
      desc = n.x;
    }
  }

  // 任務
  if (sel.sub && detail?.missions?.[sel.sub]) {
    const m = detail.missions[sel.sub];
    title = m.t;
    sub = m.y === "main" ? t("主線任務") : t("支線任務");
    desc = [m.x, m.exp ? `EXP ${m.exp}` : ""].filter(Boolean).join("\n");
  }

  return { title, sub, desc, groups };
}

export function MarkerPanel({
  sel,
  detail,
  panel,
  collected,
  onToggleCollected,
  onClose,
}: {
  sel: Selection;
  detail: MapDetail | null;
  panel: MapPanel | null;
  collected: Set<string>;
  onToggleCollected: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const { title, sub, desc, groups } = contentOf(sel, detail, panel);
  const cid = `${sel.cat}:${sel.idx - 1}`;
  const done = collected.has(cid);

  return (
    <div className="pmap-panel">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="truncate text-base font-bold text-ink">{title}</h3>
            <span className="shrink-0 text-xs text-ink-muted">
              {sel.label} {sel.idx}
            </span>
          </div>
          {/* 座標與遊戲內顯示同一套,方便直接照著走 */}
          <div className="mt-0.5 font-mono text-xs text-ink-muted tabular-nums">
            X {Math.round(sel.x)} · Y {Math.round(sel.y)} · Z {sel.z}m
          </div>
          {(sub || (typeof sel.lv === "number" && sel.lv > 0)) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {typeof sel.lv === "number" && sel.lv > 0 && (
                <span className="rounded-md bg-card-soft px-1.5 py-0.5 text-[11px] font-semibold text-ink ring-1 ring-line">
                  Lv {sel.lv}
                </span>
              )}
              {sub && <span className="text-xs text-ink-muted">{sub}</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("關閉")}
          className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-card-soft hover:text-ink"
        >
          <FiX size={18} />
        </button>
      </header>

      <div className="palworld-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* 收集品才有「已發現」開關 —— 礦石寶箱會重生,勾了沒意義 */}
        {sel.collectable && (
          <button
            type="button"
            onClick={() => onToggleCollected(cid)}
            className={`mb-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 transition ${
              done ? "bg-pal/15 text-pal ring-pal" : "bg-card-soft text-ink-muted ring-line hover:ring-pal/60"
            }`}
          >
            {done ? <FiEye size={16} /> : <FiEyeOff size={16} />}
            <span className="flex-1 text-left">{done ? t("已發現") : t("未發現")}</span>
            <span className="text-xs font-normal opacity-70">{t("點擊切換")}</span>
          </button>
        )}

        {desc && <p className="mb-3 text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">{desc}</p>}

        {groups.map((g, gi) => (
          <section key={gi} className="mb-4">
            <h4 className="mb-1.5 text-xs font-bold text-ink-muted">{g.label}</h4>
            {/* 三欄:道具(含圖) / 數量 / 機率。數字靠右對齊才好掃視。 */}
            <div className="overflow-hidden rounded-xl ring-1 ring-line">
              <div className="flex items-center gap-2 bg-card-soft px-3 py-1.5 text-[11px] font-semibold text-ink-muted">
                <span className="flex-1">{t("道具")}</span>
                <span className="w-16 text-right">{t("數量")}</span>
                <span className="w-14 text-right">{t("機率")}</span>
              </div>
              {g.items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-t border-line px-3 py-2 text-[13px] text-ink first:border-t-0"
                >
                  {ICON(it.i) ? (
                    <img
                      src={ICON(it.i) as string}
                      alt=""
                      loading="lazy"
                      className="size-7 shrink-0 rounded-md bg-card-soft object-contain"
                      onError={(e) => {
                        // 有 18 種圖示在來源就抓不到,壞圖直接收起來比顯示破圖好
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="size-7 shrink-0 rounded-md bg-card-soft" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{it.n}</span>
                  <span className="w-16 shrink-0 text-right text-ink-muted tabular-nums">
                    {it.q !== undefined && it.q !== null && String(it.q) !== "" ? `×${it.q}` : ""}
                  </span>
                  <span className="w-14 shrink-0 text-right text-ink-muted tabular-nums">
                    {typeof it.r === "number" ? `${it.r >= 1 ? it.r.toFixed(1) : it.r.toFixed(2)}%` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

        {!groups.length && !desc && (
          <p className="py-6 text-center text-[13px] text-ink-muted">{t("這個標記沒有更多資料")}</p>
        )}
      </div>
    </div>
  );
}
