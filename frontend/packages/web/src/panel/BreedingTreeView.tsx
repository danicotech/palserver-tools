// 「帕魯配種樹」互動樹狀元件(參考 palbreed.com/breeding-tree 重構):
//   目標在頂端(👑),點任一節點 → 下方「選擇父母」面板列出全部組合,
//   點組合把節點往下展開成兩個親代;親代可再展開,無限延伸;可拖曳/縮放。
//   玩家視角開啟時,每個節點標記 ✓ 已擁有 / 缺,並總結還缺哪些帕魯。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { BreedingGender } from "../breedingSolver";
import { parentsOf, type BreedingTableIndex } from "../breedingTable";
import { palInfo } from "./paldex";
import { t, useI18n } from "../i18n";

const NODE_W = 120;
const NODE_H = 136;
const X_GAP = 28;
const Y_GAP = 76;
const PAD = 40;
const PAGE = 40;

/** 屬性 → 顏色(全配種 UI 共用;沿用面板 ElementBadge 色票)。 */
export const EL_COLORS: Record<string, string> = {
  火: "bg-orange-500/90",
  水: "bg-sky-500/90",
  草: "bg-lime-500/90",
  雷: "bg-yellow-400/95 text-black",
  電: "bg-yellow-400/95 text-black",
  冰: "bg-cyan-400/90 text-black",
  龍: "bg-violet-500/90",
  暗: "bg-fuchsia-800/90",
  地: "bg-amber-700/90",
  無: "bg-neutral-500/85",
};

export function ElementDot({ el, size = "sm" }: { el: string; size?: "sm" | "md" }): JSX.Element {
  const cls = EL_COLORS[el] ?? "bg-neutral-600/85";
  const sz = size === "md" ? "size-6 text-xs" : "size-5 text-[11px]";
  return (
    <span className={`flex ${sz} items-center justify-center rounded-full font-bold text-white ring-1 ring-black/20 ${cls}`} title={el}>
      {el}
    </span>
  );
}

interface TNode {
  key: number;
  species: string;
  parents?: [TNode, TNode];
}

interface Placed {
  node: TNode;
  x: number;
  y: number;
}

/** 依目標快取整棵樹(模組層):切去反查/其他分頁再回來,規劃不會遺失。 */
const TREE_CACHE = new Map<string, { root: TNode; nextKey: number; selectedKey: number }>();

/** 遞迴佈局:根(目標)在最上層,親代往下展開;葉節點依序排,父節點置中於子節點之上。 */
function layoutTree(root: TNode): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  let leaf = 0;
  let maxDepth = 0;
  const visit = (node: TNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    let x: number;
    if (node.parents) {
      const x1 = visit(node.parents[0], depth + 1);
      const x2 = visit(node.parents[1], depth + 1);
      x = (x1 + x2) / 2;
    } else {
      x = leaf * (NODE_W + X_GAP);
      leaf += 1;
    }
    placed.push({ node, x, y: depth * (NODE_H + Y_GAP) });
    return x;
  };
  visit(root, 0);
  return {
    placed,
    width: Math.max(1, leaf) * (NODE_W + X_GAP) - X_GAP + PAD * 2,
    height: (maxDepth + 1) * (NODE_H + Y_GAP) - Y_GAP + PAD * 2,
  };
}

/** 樹上的葉節點(尚未展開者)= 實際要準備的帕魯。 */
function collectLeaves(node: TNode, out: string[] = []): string[] {
  if (node.parents) {
    collectLeaves(node.parents[0], out);
    collectLeaves(node.parents[1], out);
  } else {
    out.push(node.species);
  }
  return out;
}

function OwnedMark({ owned }: { owned: boolean }): JSX.Element {
  return owned ? (
    <span className="rounded-full bg-grass px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">✓ {t("已擁有")}</span>
  ) : (
    <span className="rounded-full bg-sun px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">{t("缺")}</span>
  );
}

export function BreedingTreeView({
  index,
  target,
  owned,
  elementsOf,
  onReverse,
}: {
  index: BreedingTableIndex;
  /** 樹根(目標帕魯)的物種 id */
  target: string;
  /** 玩家視角:小寫物種集合;null = 未啟用 */
  owned: Set<string> | null;
  /** 物種 → 屬性繁中字(角標用;拿不到給空陣列) */
  elementsOf: (id: string) => string[];
  /** 點節點名稱跳反查 */
  onReverse: (id: string) => void;
}): JSX.Element {
  useI18n();
  const keyRef = useRef(1);
  const [root, setRoot] = useState<TNode>({ key: 0, species: target });
  const [selectedKey, setSelectedKey] = useState<number>(0);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [pickerQ, setPickerQ] = useState("");
  const [pickerLimit, setPickerLimit] = useState(PAGE);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number; id: number } | null>(null);

  // 換目標 → 有快取就還原(含切走再回來),沒有才重置
  useEffect(() => {
    const cached = TREE_CACHE.get(target);
    keyRef.current = cached?.nextKey ?? 1;
    setRoot(cached?.root ?? { key: 0, species: target });
    setSelectedKey(cached?.selectedKey ?? 0);
    setPickerQ("");
    setPickerLimit(PAGE);
  }, [target]);

  // 任何樹變動都寫回快取(unmount 後仍在,回來即還原)
  useEffect(() => {
    TREE_CACHE.set(target, { root, nextKey: keyRef.current, selectedKey });
  }, [target, root, selectedKey]);

  const layout = useMemo(() => layoutTree(root), [root]);

  // 佈局改變(展開/收合)→ 水平置中、貼頂
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    setView((v) => ({ ...v, x: (vp.clientWidth - layout.width * v.z) / 2, y: 12 }));
  }, [layout.width]);

  const findNode = (node: TNode, key: number): TNode | null => {
    if (node.key === key) return node;
    if (!node.parents) return null;
    return findNode(node.parents[0], key) ?? findNode(node.parents[1], key);
  };
  const selected = findNode(root, selectedKey);

  /** 不可變更新:展開/收合指定節點。 */
  const mutate = (key: number, fn: (n: TNode) => TNode) => {
    const walk = (node: TNode): TNode => {
      if (node.key === key) return fn(node);
      if (!node.parents) return node;
      return { ...node, parents: [walk(node.parents[0]), walk(node.parents[1])] };
    };
    setRoot((r) => walk(r));
  };
  const expand = (key: number, p1: string, p2: string) => {
    mutate(key, (n) => ({
      ...n,
      parents: [
        { key: keyRef.current++, species: p1 },
        { key: keyRef.current++, species: p2 },
      ],
    }));
  };
  const collapse = (key: number) => mutate(key, (n) => ({ key: n.key, species: n.species }));

  const isOwned = (sp: string) => owned?.has(sp.toLowerCase()) ?? false;
  const nameOf = (id: string) => palInfo(id).zh || id;

  // ---- 選擇父母面板資料 ----
  const combos = useMemo(() => {
    if (!selected) return [];
    const raw = pickerQ.trim();
    const lower = raw.toLowerCase();
    const rows = parentsOf(index, selected.species).filter(
      ([p1, , p2]) =>
        !raw ||
        p1.toLowerCase().includes(lower) ||
        p2.toLowerCase().includes(lower) ||
        Boolean(palInfo(p1).zh?.includes(raw)) ||
        Boolean(palInfo(p2).zh?.includes(raw)),
    );
    const score = ([p1, , p2]: readonly [string, BreedingGender, string, BreedingGender, string]) =>
      owned ? (isOwned(p1) ? 1 : 0) + (isOwned(p2) ? 1 : 0) : 0;
    return [...rows].sort((a, b) => score(b) - score(a) || nameOf(a[0]).localeCompare(nameOf(b[0])));
  }, [index, selected?.species, pickerQ, owned]);
  useEffect(() => setPickerLimit(PAGE), [selectedKey, pickerQ]);

  // ---- 玩家視角總結 ----
  const leaves = useMemo(() => collectLeaves(root), [root]);
  const missing = useMemo(() => (owned ? [...new Set(leaves.filter((s) => !isOwned(s)))] : []), [leaves, owned]);
  const ownedLeaves = useMemo(() => (owned ? [...new Set(leaves.filter((s) => isOwned(s)))] : []), [leaves, owned]);

  // ---- 拖曳 / 縮放 ----
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.px), y: d.vy + (e.clientY - d.py) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const zoomBy = (f: number, anchor?: { x: number; y: number }) =>
    setView((v) => {
      const z = Math.min(1.6, Math.max(0.35, v.z * f));
      const vp = viewportRef.current;
      if (!vp) return { ...v, z };
      // 錨點縮放:預設視窗中心;滾輪縮放用游標位置
      const cx = anchor?.x ?? vp.clientWidth / 2;
      const cy = anchor?.y ?? vp.clientHeight / 2;
      return { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
    });

  // 滾輪縮放:React 的 onWheel 是被動監聽,preventDefault 擋不住頁面捲動,
  // 改用非被動原生監聽,讓滾輪只縮放畫布不捲頁面。
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);
  const fit = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const z = Math.min(1, (vp.clientWidth - 16) / layout.width, (vp.clientHeight - 16) / layout.height);
    const zz = Math.max(0.35, z);
    setView({ z: zz, x: (vp.clientWidth - layout.width * zz) / 2, y: 8 });
  };

  return (
    <div className="space-y-3">
      {/* 玩家視角總結列 */}
      {owned && (
        <div className="flex flex-wrap items-center gap-1.5">
          {missing.length === 0 ? (
            <span className="rounded-full bg-grass/15 px-3 py-1.5 text-sm font-bold text-grass ring-1 ring-grass/40">
              🎉 {t("這棵樹的 {n} 隻素材帕魯你全都有,可以直接開配!", { n: leaves.length })}
            </span>
          ) : (
            <>
              <span className="rounded-full bg-grass/15 px-3 py-1.5 text-sm font-semibold text-grass ring-1 ring-grass/40">
                ✓ {t("已擁有 {n} 種", { n: ownedLeaves.length })}
              </span>
              <span className="rounded-full bg-sun/15 px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-sun/40">
                ❗ {t("還缺 {n} 種:", { n: missing.length })}
              </span>
              {missing.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => onReverse(sp)}
                  title={t("查看 {name} 的配方", { name: nameOf(sp) })}
                  className="flex min-h-9 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold text-ink ring-1 ring-sun/50 transition hover:ring-pal"
                >
                  {palInfo(sp).iconUrl && <img src={palInfo(sp).iconUrl} alt="" className="size-6 rounded-full opacity-70 grayscale" />}
                  {nameOf(sp)}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* 樹畫布 */}
      <div
        ref={viewportRef}
        className="relative h-[52dvh] min-h-[340px] touch-none overflow-hidden rounded-cute bg-card-soft/60 ring-1 ring-line select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: layout.width, height: layout.height }}
        >
          {/* 連接線:子節點底部 → 橫槓 → 兩親代頂端;箭頭朝上指向子代 */}
          <svg className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
            {layout.placed
              .filter((p) => p.node.parents)
              .map((p) => {
                const kids = p.node.parents!.map((k) => layout.placed.find((q) => q.node.key === k.key)!);
                const cx = p.x + PAD + NODE_W / 2;
                const cy = p.y + PAD + NODE_H - 14;
                const midY = cy + Y_GAP / 2 + 14;
                return (
                  <g key={p.node.key} stroke="var(--color-ink-muted)" strokeOpacity="0.55" strokeWidth="2" fill="none">
                    <path d={`M ${cx} ${cy + 14} L ${cx} ${midY}`} />
                    <path d={`M ${kids[0].x + PAD + NODE_W / 2} ${midY} L ${kids[1].x + PAD + NODE_W / 2} ${midY}`} />
                    {kids.map((k) => (
                      <path key={k.node.key} d={`M ${k.x + PAD + NODE_W / 2} ${midY} L ${k.x + PAD + NODE_W / 2} ${k.y + PAD}`} />
                    ))}
                    <path
                      d={`M ${cx - 5} ${cy + 13} L ${cx} ${cy + 5} L ${cx + 5} ${cy + 13} Z`}
                      fill="var(--color-ink-muted)"
                      fillOpacity="0.8"
                      stroke="none"
                    />
                  </g>
                );
              })}
          </svg>
          {layout.placed.map(({ node, x, y }) => {
            const info = palInfo(node.species);
            const isRoot = node.key === 0;
            const sel = node.key === selectedKey;
            return (
              <div key={node.key} className="absolute" style={{ left: x + PAD, top: y + PAD, width: NODE_W, height: NODE_H }}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(node.key)}
                  className={`relative flex size-full flex-col items-center justify-start gap-1 rounded-xl bg-card p-2 pt-2.5 shadow-cute ring-2 transition ${
                    sel ? "ring-pal" : isRoot ? "ring-sun" : "ring-line hover:ring-pal"
                  }`}
                >
                  {isRoot && <span className="absolute -top-3.5 text-base leading-none">👑</span>}
                  {owned && (
                    <span className="absolute -top-2 -left-1.5">
                      <OwnedMark owned={isOwned(node.species)} />
                    </span>
                  )}
                  {/* 玩家缺這隻 → 灰階頭像,一眼看出還沒入手 */}
                  <img
                    src={info.iconUrl}
                    alt=""
                    className={`size-12 rounded-full bg-card-soft ring-1 ring-line ${owned && !isOwned(node.species) ? "opacity-70 grayscale" : ""}`}
                  />
                  <span className="w-full truncate text-center text-[13px] leading-tight font-bold text-ink">{nameOf(node.species)}</span>
                  <span className="flex gap-0.5">
                    {elementsOf(node.species).map((e) => (
                      <ElementDot key={e} el={e} />
                    ))}
                  </span>
                </button>
                {node.parents ? (
                  <button
                    type="button"
                    aria-label={t("收合")}
                    title={t("收合")}
                    onClick={() => collapse(node.key)}
                    className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-berry text-xs font-bold text-white shadow-sm transition hover:brightness-110"
                  >
                    ✕
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("展開父母")}
                    title={t("展開父母")}
                    onClick={() => setSelectedKey(node.key)}
                    className="absolute -bottom-3 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full bg-grass text-base font-bold text-white shadow-sm transition hover:brightness-110"
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* 縮放控制 */}
        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
          <button type="button" onClick={() => zoomBy(1.2)} className="flex size-9 items-center justify-center rounded-lg bg-card text-lg font-bold text-ink shadow-cute ring-1 ring-line" aria-label={t("放大")}>+</button>
          <button type="button" onClick={() => zoomBy(1 / 1.2)} className="flex size-9 items-center justify-center rounded-lg bg-card text-lg font-bold text-ink shadow-cute ring-1 ring-line" aria-label={t("縮小")}>−</button>
          <button type="button" onClick={fit} className="flex size-9 items-center justify-center rounded-lg bg-card text-xs font-bold text-ink shadow-cute ring-1 ring-line" aria-label={t("符合寬度")}>⤢</button>
        </div>
        <p className="absolute right-2 bottom-2 rounded-full bg-card/80 px-2.5 py-1 text-[10px] text-ink-muted backdrop-blur-sm">
          {t("拖曳平移 · 滾輪縮放 · 點節點選父母")}
        </p>
      </div>

      {/* 選擇父母面板 */}
      {selected && (
        <div className="overflow-hidden rounded-cute bg-card shadow-cute ring-1 ring-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-card-soft/60 px-3 py-2">
            <img src={palInfo(selected.species).iconUrl} alt="" className="size-8 rounded-full bg-card-soft ring-1 ring-line" />
            <p className="min-w-0 flex-1 text-sm font-bold text-ink">
              {t("為「{name}」選擇父母組合({n} 組)", { name: nameOf(selected.species), n: combos.length })}
            </p>
            {selected.parents && (
              <button
                type="button"
                onClick={() => collapse(selected.key)}
                className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-berry ring-1 ring-berry/40 transition hover:ring-berry"
              >
                ✕ {t("收合此節點")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onReverse(selected.species)}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
            >
              🔄 {t("反查")}
            </button>
          </div>
          <div className="border-b border-line p-2">
            <input
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
              placeholder={t("篩選父母…")}
              className="w-full rounded-lg bg-card-soft px-3 py-2 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-pal sm:text-sm"
            />
          </div>
          {combos.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">{t("沒有符合的組合")}</p>
          ) : (
            <>
              <ul className="max-h-72 overflow-y-auto">
                {combos.slice(0, pickerLimit).map(([p1, , p2], i) => {
                  const current = selected.parents && selected.parents[0].species === p1 && selected.parents[1].species === p2;
                  return (
                    <li key={`${p1}-${p2}-${i}`}>
                      <button
                        type="button"
                        onClick={() => expand(selected.key, p1, p2)}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5 px-3 py-2 text-left transition odd:bg-card-soft/50 hover:bg-pal/8 ${
                          current ? "bg-pal/10" : ""
                        }`}
                      >
                        {[p1, p2].map((p, side) => (
                          <span key={side} className="flex min-w-0 items-center gap-1.5">
                            {palInfo(p).iconUrl && (
                              <img
                                src={palInfo(p).iconUrl}
                                alt=""
                                loading="lazy"
                                className={`size-8 shrink-0 rounded-full bg-card-soft ring-1 ring-line ${owned && !isOwned(p) ? "opacity-70 grayscale" : ""}`}
                              />
                            )}
                            <span className="truncate text-sm font-medium text-ink">{nameOf(p)}</span>
                            {owned && (isOwned(p) ? <span className="shrink-0 text-xs font-bold text-grass">✓</span> : <span className="shrink-0 text-xs font-bold text-sun">{t("缺")}</span>)}
                            {side === 0 && <span className="ml-auto pl-1 text-sm font-bold text-ink-muted">+</span>}
                          </span>
                        ))}
                        <span className="justify-self-end text-sm font-bold text-pal">{current ? t("已展開") : t("展開 ▾")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {combos.length > pickerLimit && (
                <div className="flex justify-center border-t border-line p-2.5">
                  <button
                    type="button"
                    onClick={() => setPickerLimit((n) => n + PAGE * 4)}
                    className="rounded-full bg-card-soft px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-pal"
                  >
                    {t("顯示更多(還有 {n} 筆)", { n: combos.length - pickerLimit })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
