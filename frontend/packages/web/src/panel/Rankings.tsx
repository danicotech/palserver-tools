// 「排行榜」分頁：玩家排行、帕魯排行、能力職（工作適性）排行。
// 註：遊戲時數不存在存檔中，故以「經驗值」作為活躍度/時數的參考代理。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import type { Dataset, OwnedPal } from "./data";
import { speciesKey, palScore, ivSum, isPerfectIv } from "./data";
import { paldexId, paldexTotal, palInfo, randomPalAvatar, localizeWork } from "./paldex";
import { RankStars, Chip, fmtNum, WorkIcon, WorkChip, RankBar, RANK_BAR_COLORS } from "./ui";
import { PalBrowser } from "./PalBrowser";
import { useRoster } from "./rosterCtx";
import { t } from "../i18n";

type Section = "player" | "pal" | "work";

// 帕魯顯示名：優先用圖鑑正確繁中名(存檔的 name_zh 對變體/BOSS 常是英文)。
const palZh = (pal: Pal): string => palInfo(pal.species).zh || pal.name_zh;
// 帕魯頭像 URL(查無回空字串)。
const palIconUrl = (pal: Pal): string => palInfo(pal.species).iconUrl || "";

// ---------- 玩家指標 ----------
interface PStat {
  player: Player;
  dexOwned: number; // 已收服的圖鑑物種數（只算真帕魯，有此帕魯就算）
  perfect: number;
  alphaSpecies: number;
  uniquePassives: number;
  lucky: number;
}
function playerStats(data: Dataset): PStat[] {
  return data.players.map((p) => {
    const passives = new Set<string>();
    const dex = new Set<string>(); // 圖鑑（pals.json id）
    const alpha = new Set<string>();
    let perfect = 0;
    let lucky = 0;
    for (const pal of p.pals) {
      const id = paldexId(pal.species);
      if (id) dex.add(id);
      if (pal.is_alpha) alpha.add(speciesKey(pal));
      if (isPerfectIv(pal)) perfect++;
      if (pal.is_lucky) lucky++;
      for (const pv of pal.passives) passives.add(pv);
    }
    return {
      player: p,
      dexOwned: dex.size,
      perfect,
      alphaSpecies: alpha.size,
      uniquePassives: passives.size,
      lucky,
    };
  });
}

const DEX_TOTAL = () => paldexTotal() || 1;
const PLAYER_METRICS: { key: string; label: string; get: (s: PStat) => number; fmt?: (n: number) => string }[] = [
  { key: "dexrate", label: "圖鑑收服達成率", get: (s) => (s.dexOwned / DEX_TOTAL()) * 100, fmt: (n) => `${n.toFixed(1)}%` },
  { key: "dex", label: "圖鑑收服數（物種）", get: (s) => s.dexOwned },
  { key: "level", label: "等級", get: (s) => s.player.level },
  { key: "exp", label: "經驗值（遊戲時數參考）", get: (s) => s.player.exp, fmt: fmtNum },
  { key: "pals", label: "帕魯總數", get: (s) => s.player.pal_count },
  { key: "perfect", label: "完美個體（IV 300）數", get: (s) => s.perfect },
  { key: "alpha", label: "α/首領收集（不重複種）", get: (s) => s.alphaSpecies },
  { key: "passive", label: "被動詞條大師（不重複被動）", get: (s) => s.uniquePassives },
  { key: "lucky", label: "稀有帕魯收集", get: (s) => s.lucky },
];

// ---------- 帕魯指標 ----------
const PAL_METRICS: { key: string; label: string; get: (p: Pal) => number; sub?: (p: Pal) => string }[] = [
  { key: "score", label: "綜合戰力", get: palScore },
  { key: "level", label: "最高等級", get: (p) => p.level, sub: (p) => `Lv ${p.level}` },
  { key: "iv", label: "個體值總和", get: ivSum, sub: (p) => `IV ${ivSum(p)}/300` },
  { key: "friendship", label: "好感度", get: (p) => p.friendship, sub: (p) => `♥ ${fmtNum(p.friendship)}` },
];

/** 由排行榜跳轉帶入 PlayerModal 的帕魯篩選:依當前指標只顯示相關帕魯。 */
type PalFilter = { kind?: string; ivTier?: string; work?: string; label?: string };

export function Rankings({ data, onPalClick }: { data: Dataset; onPalClick: (p: Pal, owner?: Player) => void }): JSX.Element {
  const [section, setSection] = useState<Section>("player");
  // 排行榜中點任一「玩家」→ 彈出該玩家的資訊(統計 + 帕魯列表),並依當前排行指標預先篩選帕魯。
  const [playerDlg, setPlayerDlg] = useState<{ player: Player; filter: PalFilter } | null>(null);
  const openPlayer = (player: Player, filter: PalFilter = {}) => setPlayerDlg({ player, filter });
  // 依名稱找回玩家物件(能力職的「工人數排行」只有名字)。
  const playerByName = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of data.players) if (!m.has(p.name)) m.set(p.name, p);
    return m;
  }, [data.players]);
  return (
    <div>
      <div className="mb-4 flex rounded-lg bg-card p-1 ring-1 ring-line">
        {(
          [
            ["player", "🧑 玩家排行"],
            ["pal", "🐾 帕魯排行"],
            ["work", "🔨 能力職排行"],
          ] as [Section, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={`flex-1 rounded-md px-3 py-2 text-sm ${
              section === k ? "bg-pal text-white" : "text-ink hover:bg-card-soft"
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {section === "player" && <PlayerRankings data={data} onOpenPlayer={openPlayer} />}
      {section === "pal" && <PalRankings data={data} onPalClick={onPalClick} />}
      {section === "work" && (
        <WorkRankings
          data={data}
          onPalClick={onPalClick}
          onOpenPlayer={(name, filter) => {
            const p = playerByName.get(name);
            if (p) openPlayer(p, filter);
          }}
        />
      )}
      {playerDlg && (
        <PlayerModal
          player={playerDlg.player}
          filter={playerDlg.filter}
          onClose={() => setPlayerDlg(null)}
          onPalClick={onPalClick}
        />
      )}
    </div>
  );
}

function BarRow({ rank, name, value, max, sub, iconUrl, color, onClick }: {
  rank: number;
  name: string;
  value: string;
  max: number;
  cur?: number;
  sub?: string;
  iconUrl?: string; // 頭像(玩家頭像 / 帕魯圖示);提供時顯示圓形頭像
  color?: string; // 長條顏色(每種排行一色);傳 RANK_BAR_COLORS 之一
  onClick?: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${onClick ? "cursor-pointer hover:bg-card-soft/60" : ""}`}
    >
      <span className={`w-6 shrink-0 text-center font-bold ${rank <= 3 ? "text-sun" : "text-ink-muted"}`}>
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank}
      </span>
      {iconUrl !== undefined && (
        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft ring-1 ring-line">
          {iconUrl && <img src={iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-ink sm:w-40 sm:flex-none">{name}</span>
      {sub && <span className="min-w-0 truncate text-xs text-ink-muted">{sub}</span>}
      <RankBar pct={max} delayMs={(rank - 1) * 40} color={color} className="hidden min-w-0 flex-1 sm:block" />
      <span className="shrink-0 text-right font-semibold tabular-nums text-pal">{value}</span>
    </div>
  );
}

// 玩家指標 → 點該玩家時,帕魯查詢要預先套用的篩選(只顯示「這個排行在算的帕魯」)。
const METRIC_PAL_FILTER: Record<string, PalFilter> = {
  perfect: { ivTier: "300", label: "完美個體（IV 300）" },
  alpha: { kind: "alpha", label: "α / 首領" },
  lucky: { kind: "lucky", label: "稀有" },
};

function PlayerRankings({ data, onOpenPlayer }: { data: Dataset; onOpenPlayer: (p: Player, filter?: PalFilter) => void }): JSX.Element {
  const { avatarUrlFor } = useRoster(); // 玩家自訂頭像(沒有則用固定隨機帕魯頭像)
  const [metric, setMetric] = useState(PLAYER_METRICS[0].key);
  const stats = useMemo(() => playerStats(data), [data]);
  const m = PLAYER_METRICS.find((x) => x.key === metric)!;
  const ranked = useMemo(() => [...stats].sort((a, b) => m.get(b) - m.get(a)), [stats, m]);
  // 沒有玩家時 ranked[0] 是 undefined，m.get() 會直接讀 undefined.dexOwned 而崩掉
  // （症狀:點「排行榜」整頁白掉,主控台噴 Cannot read properties of undefined）。
  // 上層已經攔掉空資料集,這裡再擋一次 —— 元件不該假設呼叫端一定有防呆。
  const top = (ranked.length > 0 ? m.get(ranked[0]) : 0) || 1;
  const palFilter = METRIC_PAL_FILTER[metric];
  // 每個指標一種顏色(依色票循環),切指標會換色。
  const barColor = RANK_BAR_COLORS[PLAYER_METRICS.findIndex((x) => x.key === metric) % RANK_BAR_COLORS.length];
  return (
    <div>
      <MetricPicker options={PLAYER_METRICS} value={metric} onChange={setMetric} />
      {palFilter && (
        <p className="mb-2 text-xs text-ink-muted">{t("點玩家會直接開啟他「{label}」的帕魯清單", { label: t(palFilter.label ?? "") })}</p>
      )}
      <div key={metric} data-seen="true" className="rounded-xl bg-card p-2 ring-1 ring-line">
        {ranked.map((s, i) => (
          <BarRow
            key={s.player.uid}
            rank={i + 1}
            name={s.player.name}
            iconUrl={avatarUrlFor(s.player.name) ?? randomPalAvatar(s.player.uid)}
            value={(m.fmt ?? String)(m.get(s))}
            max={(m.get(s) / top) * 100}
            color={barColor}
            onClick={() => onOpenPlayer(s.player, palFilter)}
          />
        ))}
      </div>
    </div>
  );
}

const PAL_METRICS_ALL = [...PAL_METRICS, { key: "nickname", label: "🏷️ 特別取名", get: () => 0 }];

type NickSort = "owner" | "score" | "level" | "nickname";
const NICK_SORTS: { key: NickSort; label: string }[] = [
  { key: "owner", label: "玩家名稱" },
  { key: "score", label: "綜合戰力" },
  { key: "level", label: "等級" },
  { key: "nickname", label: "暱稱" },
];

function PalRankings({ data, onPalClick }: { data: Dataset; onPalClick: (p: Pal, owner?: Player) => void }): JSX.Element {
  const [metric, setMetric] = useState(PAL_METRICS[0].key);
  const nickMode = metric === "nickname";
  const m = PAL_METRICS.find((x) => x.key === metric) ?? PAL_METRICS[0];

  // 特別取名專用工具
  const [nickOwner, setNickOwner] = useState(""); // 玩家 uid（空＝全部）
  const [nickSort, setNickSort] = useState<NickSort>("owner");
  const [nickQ, setNickQ] = useState("");

  const nickAll = useMemo(
    () => data.allPals.filter((o) => o.pal.nickname && o.pal.nickname.trim()),
    [data.allPals],
  );
  const nickOwnerOpts = useMemo(() => {
    const map = new Map<string, { uid: string; name: string; count: number }>();
    for (const o of nickAll) {
      const e = map.get(o.owner.uid) ?? { uid: o.owner.uid, name: o.owner.name, count: 0 };
      e.count++;
      map.set(o.owner.uid, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [nickAll]);

  const ranked = useMemo(() => {
    if (nickMode) {
      const s = nickQ.trim().toLowerCase();
      const list = nickAll.filter(
        (o) =>
          (!nickOwner || o.owner.uid === nickOwner) &&
          (!s ||
            o.pal.nickname.toLowerCase().includes(s) ||
            o.pal.name_zh.toLowerCase().includes(s) ||
            o.owner.name.toLowerCase().includes(s)),
      );
      return [...list].sort((a, b) => {
        if (nickSort === "owner") return a.owner.name.localeCompare(b.owner.name) || palScore(b.pal) - palScore(a.pal);
        if (nickSort === "level") return b.pal.level - a.pal.level;
        if (nickSort === "nickname") return a.pal.nickname.localeCompare(b.pal.nickname);
        return palScore(b.pal) - palScore(a.pal);
      });
    }
    return [...data.allPals].sort((a, b) => m.get(b.pal) - m.get(a.pal)).slice(0, 50);
  }, [data.allPals, m, nickMode, nickAll, nickOwner, nickSort, nickQ]);
  const top = !nickMode && ranked[0] ? m.get(ranked[0].pal) : 1;
  const barColor = RANK_BAR_COLORS[PAL_METRICS_ALL.findIndex((x) => x.key === metric) % RANK_BAR_COLORS.length];
  return (
    <div>
      <MetricPicker options={PAL_METRICS_ALL} value={metric} onChange={setMetric} />
      {nickMode && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <input
            value={nickQ}
            onChange={(e) => setNickQ(e.target.value)}
            placeholder={t("🔍 搜尋暱稱 / 帕魯 / 玩家…")}
            className="min-w-44 flex-1 rounded-lg bg-card-soft px-3 py-1.5 text-base text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal sm:text-sm"
          />
          <span className="text-ink-muted">{t("玩家")}</span>
          <select
            value={nickOwner}
            onChange={(e) => setNickOwner(e.target.value)}
            className={`rounded-lg bg-card-soft px-2 py-1.5 text-base ring-1 ring-line sm:text-sm ${nickOwner ? "text-pal" : "text-ink"}`}
          >
            <option value="">{t("全部玩家（{n}）", { n: nickOwnerOpts.length })}</option>
            {nickOwnerOpts.map((o) => (
              <option key={o.uid} value={o.uid}>{o.name}（{o.count}）</option>
            ))}
          </select>
          <span className="text-ink-muted">{t("排序")}</span>
          <select
            value={nickSort}
            onChange={(e) => setNickSort(e.target.value as NickSort)}
            className="rounded-lg bg-card-soft px-2 py-1.5 text-base text-ink ring-1 ring-line sm:text-sm"
          >
            {NICK_SORTS.map((s) => (
              <option key={s.key} value={s.key}>{t(s.label)}</option>
            ))}
          </select>
        </div>
      )}
      {nickMode && (
        <div className="mb-2 text-xs text-ink-muted">
          {nickOwner ? `${nickOwnerOpts.find((o) => o.uid === nickOwner)?.name}：` : t("全服 ")}
          {t("{n} 隻被特別取名的帕魯", { n: ranked.length })}
        </div>
      )}
      <div key={metric} data-seen="true" className="rounded-xl bg-card p-2 ring-1 ring-line">
        {ranked.map(({ pal, owner }, i) =>
          nickMode ? (
            <button
              key={i}
              onClick={() => onPalClick(pal, owner)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card-soft/60"
            >
              <span className="w-6 shrink-0 text-right text-xs text-ink-muted">{i + 1}</span>
              <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft ring-1 ring-line">
                {palIconUrl(pal) && <img src={palIconUrl(pal)} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-sun">「{pal.nickname}」</span>
              <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">{palZh(pal)}</span>
              <span className="shrink-0 text-xs text-ink-muted">Lv{pal.level}</span>
              <span className="ml-auto shrink-0 truncate text-xs font-medium text-ink">👤 {owner.name}</span>
            </button>
          ) : (
            <BarRow
              key={i}
              rank={i + 1}
              name={palZh(pal)}
              iconUrl={palIconUrl(pal)}
              sub={`${owner.name}${pal.is_alpha ? " · α" : ""}`}
              value={m.sub ? m.sub(pal) : String(m.get(pal))}
              max={(m.get(pal) / top) * 100}
              color={barColor}
              onClick={() => onPalClick(pal, owner)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function WorkRankings({ data, onPalClick, onOpenPlayer }: { data: Dataset; onPalClick: (p: Pal, owner?: Player) => void; onOpenPlayer: (name: string, filter?: PalFilter) => void }): JSX.Element {
  const { avatarUrlFor } = useRoster();
  const works = useMemo(() => {
    const set = new Set<string>();
    for (const { pal } of data.allPals) for (const w of Object.keys(pal.work)) set.add(w);
    return [...set].sort();
  }, [data.allPals]);
  const [work, setWork] = useState(works[0] ?? "");

  const ranked = useMemo(() => {
    const list = data.allPals.filter(({ pal }) => (pal.work[work] ?? 0) > 0);
    return list.sort((a, b) => (b.pal.work[work] ?? 0) - (a.pal.work[work] ?? 0) || palScore(b.pal) - palScore(a.pal)).slice(0, 40);
  }, [data.allPals, work]);

  const perPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const { pal, owner } of data.allPals) if ((pal.work[work] ?? 0) > 0) m.set(owner.name, (m.get(owner.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data.allPals, work]);

  const barColor = RANK_BAR_COLORS[Math.max(0, works.indexOf(work)) % RANK_BAR_COLORS.length];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {works.map((w) => (
          <button
            key={w}
            onClick={() => setWork(w)}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm ${
              work === w ? "bg-pal text-white" : "bg-card-soft text-ink hover:bg-line"
            }`}
          >
            <WorkIcon work={w} size={16} />
            {localizeWork(w)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">{t("「{work}」最強帕魯", { work: localizeWork(work) })}</div>
          <div className="rounded-xl bg-card p-2 ring-1 ring-line">
            {ranked.map(({ pal, owner }, i) => (
              <button
                key={i}
                onClick={() => onPalClick(pal, owner)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card-soft/60"
              >
                <span className="w-5 shrink-0 text-right text-xs text-ink-muted">{i + 1}</span>
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft ring-1 ring-line">
                  {palIconUrl(pal) && <img src={palIconUrl(pal)} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <WorkChip work={work} level={pal.work[work]} />
                <RankStars rank={pal.rank} />
                <span className="min-w-0 flex-1 truncate text-ink">{palZh(pal)}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-ink-muted">{owner.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">{t("「{work}」工人數排行（玩家）", { work: localizeWork(work) })}</div>
          <div key={work} data-seen="true" className="rounded-xl bg-card p-2 ring-1 ring-line">
            {perPlayer.map(([name, count], i) => (
              <BarRow
                key={name}
                rank={i + 1}
                name={name}
                iconUrl={avatarUrlFor(name) ?? randomPalAvatar(name)}
                value={t("{n} 隻", { n: count })}
                max={(count / (perPlayer[0]?.[1] ?? 1)) * 100}
                color={barColor}
                onClick={() => onOpenPlayer(name, { work, label: localizeWork(work) })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 玩家資訊彈窗:概況統計 + 該玩家的帕魯瀏覽器(可再點帕魯看詳情)。
 *  filter:由排行榜跳轉帶入,預先篩選出「該排行在算的帕魯」(可在瀏覽器內再調整)。 */
function PlayerModal({
  player,
  filter,
  onClose,
  onPalClick,
}: {
  player: Player;
  filter?: PalFilter;
  onClose: () => void;
  onPalClick: (p: Pal, owner?: Player) => void;
}): JSX.Element {
  const st = useMemo(() => {
    const passives = new Set<string>();
    const dex = new Set<string>();
    const alpha = new Set<string>();
    let perfect = 0;
    let lucky = 0;
    for (const pal of player.pals) {
      const id = paldexId(pal.species);
      if (id) dex.add(id);
      if (pal.is_alpha) alpha.add(speciesKey(pal));
      if (isPerfectIv(pal)) perfect++;
      if (pal.is_lucky) lucky++;
      for (const pv of pal.passives) passives.add(pv);
    }
    return { dex: dex.size, perfect, alpha: alpha.size, lucky, passives: passives.size };
  }, [player]);

  const tiles: [string, string | number][] = [
    [t("等級"), player.level],
    [t("帕魯總數"), player.pal_count],
    [t("經驗值"), fmtNum(player.exp)],
    [t("圖鑑物種"), st.dex],
    [t("完美個體"), st.perfect],
    [t("α/首領種"), st.alpha],
    [t("不重複被動"), st.passives],
    [t("稀有"), st.lucky],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-6xl overflow-y-auto rounded-xl border border-line bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">👤 {player.name}</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-ink-muted hover:bg-card-soft hover:text-ink"
            aria-label={t("關閉")}
          >
            ✕
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-card-soft/60 px-3 py-2 text-center">
              <div className="text-lg font-bold tabular-nums text-ink">{value}</div>
              <div className="text-xs text-ink-muted">{label}</div>
            </div>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span>{t("帕魯（{n} 隻）· 點卡片看詳情", { n: player.pal_count })}</span>
          {filter?.label && (
            <span className="text-xs font-normal text-ink-muted">{t("已依「{label}」預先篩選,下方可點 ✕ 取消", { label: t(filter.label) })}</span>
          )}
        </div>
        <PalBrowser
          pals={player.pals.map((p): OwnedPal => ({ pal: p, owner: player }))}
          showOwner={false}
          onPalClick={onPalClick}
          initialKind={filter?.kind}
          initialIvTier={filter?.ivTier}
          initialWork={filter?.work}
        />
      </div>
    </div>
  );
}

function MetricPicker<T extends { key: string; label: string }>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: string;
  onChange: (k: string) => void;
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1.5 text-sm ${
            value === o.key ? "bg-pal text-white" : "bg-card-soft text-ink hover:bg-line"
          }`}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
