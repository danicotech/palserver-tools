// 點擊地圖標記後彈出的右側詳細面板。
//
// 為什麼要獨立成面板而不是塞進滑鼠提示:提示只能放三四行,
// 但藏寶圖有 5 組、每組三十幾項,寶箱與頭目也都有完整掉落表。
// 提示負責「這是什麼」,面板負責「裡面有什麼」。
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { FiX, FiEye, FiEyeOff, FiCopy, FiCheck, FiCrosshair } from "react-icons/fi";
import {
  panelKindOf,
  detailKey,
  INCIDENT_CATEGORY,
  NOTE_CATEGORY,
  type MapDetail,
  type MapPanel,
  type DetailItem,
} from "./mapPoints";
import { palInfo } from "./paldex";
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

/** 一列要顯示的圖:帕魯優先用頭像(蛋的孵化清單),其餘用道具圖示。
 *  十幾種帕魯配同一張蛋圖分不出差別,頭像才看得出孵到什麼。 */
const rowIcon = (it: DetailItem): { url: string | null; round: boolean } => {
  if (it.pal) return { url: palInfo(it.pal.toLowerCase()).iconUrl || null, round: true };
  return { url: it.i ? `/game-data/item-icons/${it.i}.webp` : null, round: false };
};

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

/** NPC 分類 → 商店名稱。只收名稱能一對一確認的三組 ——
 *  村莊商店、商隊商店 1–25、競技場商店那些對不到特定 NPC,
 *  硬猜會把商品標到錯的人身上,不如不標。 */
const NPC_SHOP: Record<string, string> = {
  NpcSalesPerson: "流浪商人商店 1",
  NpcMedalTrader: "獎章商店 1",
  NpcBountyTrader: "賞金商店 1",
};

/** 這個標記有沒有東西可以看?沒有就不該開面板 ——
 *  礦石、原油、夜星砂那些點開只會看到「沒有更多資料」,白費一次點擊。
 *  用 contentOf 實際跑一次而不是維護一份「哪些類別沒資料」的清單:
 *  之後補了資料,面板會自己開始運作,不必記得回來改這裡。 */
export function hasPanelContent(sel: Selection, detail: MapDetail | null, panel: MapPanel | null): boolean {
  const c = contentOf(sel, detail, panel);
  return c.groups.length > 0 || !!c.desc || !!c.img || !!c.bullets?.length;
}

/** 蒐集這個標記能顯示的所有內容:副標題、說明、分組品項。 */
function contentOf(
  sel: Selection,
  detail: MapDetail | null,
  panel: MapPanel | null,
): { title: string; sub?: string; desc?: string; groups: Group[]; img?: string; bullets?: string[] } {
  const groups: Group[] = [];
  let title = sel.name || sel.label;
  let sub: string | undefined;
  let desc: string | undefined;
  let img: string | undefined;
  let bullets: string[] | undefined;

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
      // 筆記的掃描原圖 —— 這類收集品的樂趣有一半在「看到那張紙」
      if (n.img) img = `/game-data/note-images/${n.img}.webp`;
    }
  }

  // 任務
  if (sel.sub && detail?.missions?.[sel.sub]) {
    const m = detail.missions[sel.sub];
    title = m.t;
    sub = m.y === "main" ? t("主線任務") : t("支線任務");
    desc = [m.x, m.exp ? `EXP ${m.exp}` : ""].filter(Boolean).join("\n");
  }

  // 商人 NPC:接上對得起來的商店品項(價格放在數量欄旁邊)
  const shopName = NPC_SHOP[sel.cat];
  if (shopName && panel?.shops) {
    const shop = panel.shops.find((x) => x.l === shopName);
    if (shop?.items.length) {
      sub = sub ?? `${t("貨幣")}:${shop.cur ?? ""}`;
      groups.push({ label: shop.l, items: shop.items });
    }
  }

  return { title, sub, desc, groups, img, bullets };
}

export function MarkerPanel({
  sel,
  detail,
  panel,
  collected,
  onToggleCollected,
  onClose,
  onLocate,
}: {
  sel: Selection;
  detail: MapDetail | null;
  panel: MapPanel | null;
  collected: Set<string>;
  onToggleCollected: (id: string) => void;
  onClose: () => void;
  /** 把鏡頭移到這個座標 */
  onLocate?: (x: number, y: number) => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  // Esc 關閉:面板蓋住地圖右側,滑鼠要移到角落才按得到 ×,鍵盤快一點
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { title, sub, desc, groups, img, bullets } = contentOf(sel, detail, panel);
  // 複製成遊戲內看得懂的格式,方便直接貼到 Discord 報座標
  const copy = () => {
    const text = `${title}  X ${Math.round(sel.x)} · Y ${Math.round(sel.y)} · Z ${sel.z}m`;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
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
          onClick={copy}
          aria-label={t("複製座標")}
          title={t("複製座標")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-card-soft hover:text-ink"
        >
          {copied ? <FiCheck size={16} className="text-grass" /> : <FiCopy size={16} />}
        </button>
        {onLocate && (
          <button
            type="button"
            onClick={() => onLocate(sel.x, sel.y)}
            aria-label={t("移到此座標")}
            title={t("移到此座標")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-card-soft hover:text-ink"
          >
            <FiCrosshair size={16} />
          </button>
        )}
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

        {/* 筆記原圖放在說明前面 —— 先看到那張紙,再讀謄錄的文字 */}
        {img && (
          <img
            src={img}
            alt=""
            loading="lazy"
            className="mb-3 w-full rounded-xl ring-1 ring-line"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}

        {desc && <p className="mb-3 text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">{desc}</p>}

        {bullets?.length && (
          <ul className="mb-3 space-y-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-1.5 text-[13px] text-ink">
                <span className="text-pal">・</span>
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {groups.map((g, gi) => {
          // 帕魯陣容那組的第二欄放的是等級而不是數量,標題與格式都要跟著換 ——
          // 不然會顯示成「×Lv.30」。
          const isLineup = g.items.every((it) => it.pal && String(it.q ?? "").startsWith("Lv"));
          const hasPrice = g.items.some((it) => typeof it.p === "number");
          return (
          <section key={gi} className="mb-4">
            <h4 className="mb-1.5 text-xs font-bold text-ink-muted">{g.label}</h4>
            {/* 三欄:道具(含圖) / 數量 / 機率。數字靠右對齊才好掃視。 */}
            <div className="overflow-hidden rounded-xl ring-1 ring-line">
              {/* 第三欄一欄兩用:掉落物放機率、商店商品放售價,標題跟著內容走,
                  不然商店的價格會被標成「機率」。 */}
              <div className="flex items-center gap-2 bg-card-soft px-3 py-1.5 text-[11px] font-semibold text-ink-muted">
                <span className="flex-1">{isLineup ? t("帕魯") : t("道具")}</span>
                <span className="w-16 text-right">{isLineup ? t("等級") : t("數量")}</span>
                <span className="w-14 text-right">{isLineup ? "" : hasPrice ? t("售價") : t("機率")}</span>
              </div>
              {g.items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-t border-line px-3 py-2 text-[13px] text-ink first:border-t-0"
                >
                  {rowIcon(it).url ? (
                    <img
                      src={rowIcon(it).url as string}
                      alt=""
                      loading="lazy"
                      className={`size-7 shrink-0 object-contain ${
                        rowIcon(it).round ? "rounded-full" : "rounded-md bg-card-soft"
                      }`}
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
                    {/* 等級本身就是完整寫法(Lv.80),不要再加上表示數量的 × */}
                    {it.q === undefined || it.q === null || String(it.q) === ""
                      ? ""
                      : isLineup
                        ? it.q
                        : `×${it.q}`}
                  </span>
                  <span className="w-14 shrink-0 text-right text-ink-muted tabular-nums">
                    {/* 掉落物看機率、商店商品看售價,同一欄兩種用途 */}
                    {typeof it.r === "number"
                      ? `${it.r >= 1 ? it.r.toFixed(1) : it.r.toFixed(2)}%`
                      : typeof it.p === "number"
                        ? it.p.toLocaleString()
                        : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
          );
        })}

        {!groups.length && !desc && (
          <p className="py-6 text-center text-[13px] text-ink-muted">{t("這個標記沒有更多資料")}</p>
        )}
      </div>
    </div>
  );
}
