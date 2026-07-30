// 「總覽」分頁：伺服器概況 KPI + 排行 + 分佈圖表（analytics 風格）。
import { useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import {
  FiUsers, FiBox, FiLayers, FiActivity, FiClock, FiHome, FiServer, FiTarget,
  FiAward, FiTrendingUp, FiShield, FiBarChart2, FiPieChart, FiStar,
} from "react-icons/fi";
import type { Pal, Player } from "./types";
import type { Dataset, OwnedPal } from "./data";
import { isPerfectIv } from "./data";
import { bossKey, getBossRoster, palInfo, palName, localizedName, paldexId, paldexTotal, randomPalAvatar } from "./paldex";
import { useRoster } from "./rosterCtx";
import { getMetrics, getStatus, getPresence, type ServerMetrics, type ServerStatus, type PresenceData } from "./api";
import { fmtNum, OnlineDot } from "./ui";
import { SwitchChart, Reveal, type Slice } from "./charts";
import { OwnerDialog } from "./PaldexProgress";
import { PalBrowser } from "./PalBrowser";
import { t } from "../i18n";

// 統一強調色（analytics 配色）
const A = {
  indigo: "#6366f1", rose: "#f43f5e", amber: "#f59e0b", violet: "#8b5cf6",
  blue: "#3b82f6", cyan: "#06b6d4", green: "#10b981", slate: "#64748b",
};
const ELEMENT_COLOR: Record<string, string> = {
  火: "#ef4444", 水: "#3b82f6", 草: "#22c55e", 雷: "#eab308", 冰: "#38bdf8",
  龍: "#8b5cf6", 暗: "#52525b", 地: "#b45309", 無: "#cbd5e1",
};
const RANK_COLOR: Record<number, string> = { 1: "#94a3b8", 2: "#22c55e", 3: "#3b82f6", 4: "#a855f7", 5: "#f59e0b" };

/** 秒數 → 「Xh Ym / Xm / Xs」。 */
function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

/** analytics 卡片：icon + 標題 + 說明 + 右側控制，底部分隔線。 */
function Panel({
  icon, accent = A.indigo, title, desc, right, children, bodyClass = "p-4",
}: {
  icon: ReactNode; accent?: string; title: string; desc?: string;
  right?: ReactNode; children: ReactNode; bodyClass?: string;
}): JSX.Element {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}22`, color: accent }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
          {desc && <p className="truncate text-xs text-ink-muted">{desc}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

function Kpi({ icon, label, value, sub, accent = A.indigo }: {
  icon: ReactNode; label: string; value: string; sub?: string; accent?: string;
}): JSX.Element {
  return (
    <div className="min-w-40 flex-1 rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${accent}22`, color: accent }}>
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function RareTile({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card-soft/40 px-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: `${accent}22`, color: accent }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums text-ink">{fmtNum(value)}</span>
        <span className="block truncate text-xs text-ink-muted">{label}</span>
      </span>
    </div>
  );
}

/** 排行列（共用視覺）：名次 → 頭像 → 名稱 → 生長長條 → 數值。 */
function RankRow({
  rank, iconUrl, name, sub, barPct, value, valueText, accent = A.indigo, online = false, onClick,
}: {
  rank: number; iconUrl: string; name: string; sub?: string; barPct: number;
  value: number; valueText?: string; accent?: string; online?: boolean; onClick: () => void;
}): JSX.Element {
  const medal = rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : null;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-card-soft">
      <span className="w-5 shrink-0 text-center">
        {medal ? <span className="text-base">{medal}</span> : <span className="text-xs font-semibold text-ink-muted">{rank}</span>}
      </span>
      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft ring-1 ring-line">
        {iconUrl && <img src={iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </span>
      {online && <OnlineDot />}
      <span className="w-16 min-w-0 flex-1 truncate font-medium text-ink sm:w-28 sm:flex-none">{name}</span>
      {sub && <span className="hidden shrink-0 whitespace-nowrap text-xs text-ink-muted sm:inline">{sub}</span>}
      <div className="hidden h-2 flex-1 overflow-hidden rounded-full bg-card-soft sm:block">
        <div className="bar-fill h-full rounded-full" style={{ width: `${barPct}%`, background: accent, animationDelay: `${(rank - 1) * 45}ms` }} />
      </div>
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{valueText ?? value}</span>
    </button>
  );
}

/** 上線時間排行：全部玩家皆列入，可切換 總時間/平均/當期 三種指標與 清單/圖表 兩種檢視。 */
function OnlineTimePanel({
  presence,
  players,
  avatarUrlFor,
  onOpenPlayer,
}: {
  presence: PresenceData;
  players: Player[];
  avatarUrlFor: (name: string) => string | undefined;
  onOpenPlayer: (name: string) => void;
}): JSX.Element {
  const [metric, setMetric] = useState<"total" | "avg" | "current">("total");
  const [view, setView] = useState<"list" | "chart">("list");

  const rows = useMemo(() => {
    const byName = new Map(presence.players.map((p) => [p.name, p]));
    const base = players.map((pl) => {
      const pr = byName.get(pl.name);
      return {
        name: pl.name,
        userId: pr?.userId ?? pl.uid,
        online: pr?.online ?? false,
        sessions: pr?.sessions ?? 0,
        total: pr?.onlineSeconds ?? 0,
        avg: pr?.avgSessionSeconds ?? 0,
        current: pr?.currentSessionSeconds ?? 0,
      };
    });
    // presence 有、但玩家清單沒有的（罕見）也補進來
    for (const p of presence.players) {
      if (!players.some((pl) => pl.name === p.name)) {
        base.push({
          name: p.name,
          userId: p.userId,
          online: p.online,
          sessions: p.sessions,
          total: p.onlineSeconds,
          avg: p.avgSessionSeconds,
          current: p.currentSessionSeconds,
        });
      }
    }
    const pick = (r: (typeof base)[number]) => (metric === "avg" ? r.avg : metric === "current" ? r.current : r.total);
    return base.sort((a, b) => pick(b) - pick(a));
  }, [presence, players, metric]);

  const val = (r: (typeof rows)[number]) => (metric === "avg" ? r.avg : metric === "current" ? r.current : r.total);
  const max = rows.length ? Math.max(1, val(rows[0])) : 1;
  const metricLabel = metric === "avg" ? t("平均每次") : metric === "current" ? t("本次上線") : t("總時間");
  const metricTabs = [
    ["total", t("總時間")],
    ["avg", t("平均")],
    ["current", t("當期")],
  ] as const;

  return (
    <Panel
      icon={<FiClock size={16} />}
      accent={A.cyan}
      title={t("上線時間排行")}
      desc={t("自 {since} 起累計 · 共 {n} 人", {
        since: new Date(presence.trackingSince * 1000).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" }),
        n: rows.length,
      })}
      right={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <div className="flex gap-0.5 rounded-full bg-card-soft p-0.5 ring-1 ring-line">
            {metricTabs.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition ${metric === k ? "bg-pal text-white" : "text-ink-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 rounded-full bg-card-soft p-0.5 ring-1 ring-line">
            <button onClick={() => setView("list")} className={`rounded-full px-2.5 py-0.5 text-xs transition ${view === "list" ? "bg-pal text-white" : "text-ink-muted hover:text-ink"}`}>{t("清單")}</button>
            <button onClick={() => setView("chart")} className={`rounded-full px-2.5 py-0.5 text-xs transition ${view === "chart" ? "bg-pal text-white" : "text-ink-muted hover:text-ink"}`}>{t("圖表")}</button>
          </div>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          {t("尚在累積上線資料（每 {n} 秒記錄一次，需有玩家上線後才會出現）", { n: presence.pollSeconds })}
        </p>
      ) : view === "chart" ? (
        <SwitchChart
          fill
          kinds={["bar", "line"]}
          labels={rows.map((r) => r.name || t("（未知）"))}
          values={rows.map((r) => Math.round((val(r) / 3600) * 10) / 10)}
          primary={A.cyan}
          unit={t(" 小時")}
        />
      ) : (
        <Reveal className="space-y-0.5">
          {rows.map((r, i) => (
            <RankRow
              key={r.userId || r.name}
              rank={i + 1}
              accent={A.cyan}
              iconUrl={avatarUrlFor(r.name) ?? randomPalAvatar(r.userId || r.name)}
              name={r.name || t("（未知）")}
              online={r.online}
              sub={`${metricLabel} · ${t("{n} 次", { n: r.sessions })}`}
              barPct={(val(r) / max) * 100}
              value={val(r)}
              valueText={fmtDuration(val(r))}
              onClick={() => onOpenPlayer(r.name)}
            />
          ))}
        </Reveal>
      )}
    </Panel>
  );
}

export function Dashboard({
  data,
  onPalClick,
  onOwnerPlayerClick,
}: {
  data: Dataset;
  onPalClick: (p: Pal, owner?: Player) => void;
  onOwnerPlayerClick?: (playerName: string, palName: string) => void;
}): JSX.Element {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [presence, setPresence] = useState<PresenceData | null>(null);
  const { avatarUrlFor } = useRoster(); // 玩家自訂頭像（連動各榜單）
  const [ownerDlg, setOwnerDlg] = useState<{ name: string; iconUrl: string; owners: [string, number][] } | null>(null);
  const [playerDlg, setPlayerDlg] = useState<Player | null>(null);
  const totalPlayers = data.players.length || 1;

  useEffect(() => {
    let alive = true;
    getMetrics().then((m) => alive && setMetrics(m));
    getStatus().then((s) => alive && setStatus(s));
    getPresence().then((p) => alive && setPresence(p));
    return () => { alive = false; };
  }, []);

  const topPlayers = useMemo(
    () => [...data.players].sort((a, b) => b.pal_count - a.pal_count).slice(0, 10),
    [data.players],
  );
  const hotSpecies = useMemo(() => data.species.slice(0, 10), [data.species]);

  const serverDex = useMemo(() => {
    const s = new Set<string>();
    for (const o of data.allPals) {
      const id = paldexId(o.pal.species);
      if (id) s.add(id);
    }
    return s.size;
  }, [data.allPals]);
  const dexTotal = paldexTotal() || 1;

  const boss = useMemo(() => {
    const roster = getBossRoster();
    const caughtKeys = new Set(data.allPals.filter((o) => o.pal.is_alpha).map((o) => bossKey(o.pal.species)));
    const caught = roster.filter((b) => caughtKeys.has(b.key));
    const uncaught = roster.filter((b) => !caughtKeys.has(b.key));
    return { total: roster.length, caught, uncaught };
  }, [data.allPals]);

  const activityTop = useMemo(
    () => [...data.players].sort((a, b) => b.exp - a.exp).slice(0, 10),
    [data.players],
  );

  const levelDist = useMemo(() => {
    const maxLv = data.players.reduce((m, p) => Math.max(m, p.level), 0);
    const top = Math.max(10, Math.ceil(maxLv / 10) * 10);
    const buckets: { label: string; count: number; names: string[] }[] = [];
    for (let lo = 1; lo <= top; lo += 10) {
      const hi = lo + 9;
      // 該等級區間的玩家名單(依等級由高到低),供 tooltip 顯示是「哪幾位玩家」。
      const names = data.players
        .filter((p) => p.level >= lo && p.level <= hi)
        .sort((a, b) => b.level - a.level)
        .map((p) => `${p.name}（Lv${p.level}）`);
      buckets.push({ label: `${lo}–${hi}`, count: names.length, names });
    }
    return buckets;
  }, [data.players]);

  const elementSlices = useMemo<Slice[]>(() => {
    const m = new Map<string, number>();
    for (const o of data.allPals) for (const e of o.pal.elements) m.set(e, (m.get(e) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([el, n]) => ({ label: el, value: n, color: ELEMENT_COLOR[el] ?? "#94a3b8" }));
  }, [data.allPals]);

  const rankSlices = useMemo<Slice[]>(() => {
    const cnt = [0, 0, 0, 0, 0];
    for (const { pal } of data.allPals) if (pal.rank >= 1 && pal.rank <= 5) cnt[pal.rank - 1]++;
    return cnt.map((n, i) => ({ label: `★${i + 1}`, value: n, color: RANK_COLOR[i + 1] }));
  }, [data.allPals]);

  const rare = useMemo(() => {
    let alpha = 0, lucky = 0, perfect = 0, fivestar = 0;
    for (const { pal } of data.allPals) {
      if (pal.is_alpha) alpha++;
      if (pal.is_lucky) lucky++;
      if (isPerfectIv(pal)) perfect++;
      if (pal.rank >= 5) fivestar++;
    }
    return { alpha, lucky, perfect, fivestar };
  }, [data.allPals]);

  const upH = metrics ? Math.floor(metrics.uptime / 3600) : 0;
  const upM = metrics ? Math.floor((metrics.uptime % 3600) / 60) : 0;
  const bossPct = boss.total ? (boss.caught.length / boss.total) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* KPI 概況 */}
      <div className="flex flex-wrap gap-3">
        {metrics ? (
          <>
            <Kpi icon={<FiUsers size={15} />} accent={A.indigo} label={t("在線玩家")} value={`${metrics.currentplayernum} / ${metrics.maxplayernum}`} />
            <Kpi icon={<FiActivity size={15} />} accent={A.green} label={t("伺服器 FPS")} value={String(metrics.serverfps)} sub={`${metrics.serverframetime.toFixed(0)} ms`} />
            <Kpi icon={<FiClock size={15} />} accent={A.cyan} label={t("遊戲天數")} value={t("第 {n} 天", { n: metrics.days })} />
            <Kpi icon={<FiServer size={15} />} accent={A.violet} label={t("運行時間")} value={t("{n} 小時", { n: upH })} sub={t("{n} 分", { n: upM })} />
            <Kpi icon={<FiHome size={15} />} accent={A.amber} label={t("據點數")} value={String(metrics.basecampnum)} />
          </>
        ) : (
          <>
            <Kpi icon={<FiUsers size={15} />} accent={A.indigo} label={t("玩家數")} value={String(data.players.length)} />
            <Kpi icon={<FiBox size={15} />} accent={A.blue} label={t("帕魯總數")} value={fmtNum(data.totalPals)} />
            <Kpi icon={<FiLayers size={15} />} accent={A.violet} label={t("帕魯物種")} value={t("{n} 種", { n: data.species.length })} />
          </>
        )}
        {status && (
          <Kpi
            icon={<FiServer size={15} />}
            accent={status.inOpenWindow ? A.green : A.slate}
            label={status.inOpenWindow ? t("目前時段（開放中）") : t("伺服器")}
            value={status.inOpenWindow ? String(status.currentLabel ?? t("開放")) : t("休息中")}
            sub={status.inOpenWindow ? t("至 {time}", { time: status.currentCloseAt ?? "" }) : t("下次開服 {time}", { time: status.nextOpenAt ?? "" })}
          />
        )}
        <Kpi
          icon={<FiTarget size={15} />}
          accent={A.rose}
          label={t("全服圖鑑收服率")}
          value={`${((serverDex / dexTotal) * 100).toFixed(1)}%`}
          sub={t("{a} / {b} 種", { a: serverDex, b: dexTotal })}
        />
      </div>

      {/* 排行：Top 玩家 / 熱門帕魯 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel icon={<FiAward size={16} />} accent={A.indigo} title={t("Top 玩家")} desc={t("依帕魯持有數排名")}>
          <Reveal className="space-y-0.5">
            {topPlayers.map((p, i) => (
              <RankRow key={p.uid} rank={i + 1} accent={A.indigo} iconUrl={avatarUrlFor(p.name) ?? randomPalAvatar(p.uid)} name={p.name}
                sub={`Lv${p.level}`} barPct={(p.pal_count / (topPlayers[0].pal_count || 1)) * 100}
                value={p.pal_count} onClick={() => setPlayerDlg(p)} />
            ))}
          </Reveal>
        </Panel>

        <Panel icon={<FiTrendingUp size={16} />} accent={A.rose} title={t("最熱門帕魯")} desc={t("全服總持有數")}>
          <Reveal className="space-y-0.5">
            {hotSpecies.map((g, i) => {
              const icon = palInfo(g.specimens[0]?.pal.species ?? "").iconUrl ?? "";
              const spName = palName(g.species) || g.name_zh;
              return (
                <RankRow key={g.key} rank={i + 1} accent={A.rose} iconUrl={icon} name={spName}
                  barPct={(g.total / (hotSpecies[0].total || 1)) * 100} value={g.total}
                  onClick={() => setOwnerDlg({ name: spName, iconUrl: icon, owners: g.perPlayer.map((pp) => [pp.player.name, pp.count]) })} />
              );
            })}
          </Reveal>
        </Panel>
      </div>

      {/* 首領收服進度 */}
      <Panel
        icon={<FiShield size={16} />}
        accent={A.amber}
        title={t("首領收服進度")}
        right={<span className="text-sm text-ink-muted">{t("已收服")} <span className="font-bold text-ink">{boss.caught.length}</span> / {boss.total}</span>}
      >
        <Reveal>
          <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-card-soft">
            <div className="bar-fill h-full rounded-full" style={{ width: `${bossPct}%`, background: `linear-gradient(90deg, ${A.amber}, ${A.green})` }} />
          </div>
        </Reveal>
        {boss.uncaught.length > 0 && (
          <>
            <div className="mb-2 text-xs font-semibold text-ink-muted">{t("尚未收服（{n} 種）", { n: boss.uncaught.length })}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {boss.uncaught.map((b) => (
                <div key={b.key + b.lv} className="flex items-center gap-2 rounded-lg border border-line bg-card-soft/50 px-2 py-1.5" title={`Lv ${b.lv}`}>
                  <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft opacity-70 ring-1 ring-line grayscale">
                    <img src={b.iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-ink">{localizedName(b.names)}</span>
                    <span className="block text-[11px] text-ink-muted">Lv {b.lv}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* 活躍度 / 等級分佈 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel icon={<FiActivity size={16} />} accent={A.violet} title={t("活躍度排行")} desc={t("存檔無時數，以經驗值為活躍度代理")}>
          <Reveal className="space-y-0.5">
            {activityTop.map((p, i) => (
              <RankRow key={p.uid} rank={i + 1} accent={A.violet} iconUrl={avatarUrlFor(p.name) ?? randomPalAvatar(p.uid)} name={p.name}
                sub={`Lv${p.level}`} barPct={(p.exp / (activityTop[0].exp || 1)) * 100}
                value={p.exp} valueText={fmtNum(p.exp)} onClick={() => setPlayerDlg(p)} />
            ))}
          </Reveal>
        </Panel>

        <Panel icon={<FiBarChart2 size={16} />} accent={A.violet} title={t("玩家等級分佈")}>
          <SwitchChart
            fill
            kinds={["line", "bar"]}
            labels={levelDist.map((b) => `Lv${b.label}`)}
            values={levelDist.map((b) => b.count)}
            primary={A.violet}
            unit={` ${t("人")}`}
            tooltipItems={levelDist.map((b) => b.names)}
          />
        </Panel>
      </div>

      {/* 屬性 / 星級 分佈 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel icon={<FiPieChart size={16} />} accent={A.blue} title={t("全服帕魯屬性分佈")}>
          <SwitchChart
            kinds={["doughnut", "pie", "bar"]}
            labels={elementSlices.map((s) => s.label)}
            values={elementSlices.map((s) => s.value)}
            colors={elementSlices.map((s) => s.color)}
            centerLabel={fmtNum(data.totalPals)}
            centerSub={t("帕魯")}
          />
        </Panel>

        <Panel icon={<FiStar size={16} />} accent={A.amber} title={t("帕魯星級分佈")}>
          <SwitchChart
            kinds={["doughnut", "pie", "bar"]}
            labels={rankSlices.map((s) => s.label)}
            values={rankSlices.map((s) => s.value)}
            colors={rankSlices.map((s) => s.color)}
            centerLabel={`${((rare.fivestar / (data.allPals.length || 1)) * 100).toFixed(0)}%`}
            centerSub={t("五星占比")}
          />
        </Panel>
      </div>

      {/* 稀有帕魯統計 */}
      <Panel icon={<FiAward size={16} />} accent={A.green} title={t("稀有帕魯統計")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <RareTile label={t("α / 首領")} value={rare.alpha} accent={A.rose} icon={<FiShield size={18} />} />
          <RareTile label={t("稀有帕魯")} value={rare.lucky} accent={A.amber} icon={<FiStar size={18} />} />
          <RareTile label={t("完美個體 (IV 300)")} value={rare.perfect} accent={A.green} icon={<FiTarget size={18} />} />
          <RareTile label={t("五星帕魯")} value={rare.fivestar} accent={A.violet} icon={<FiAward size={18} />} />
        </div>
      </Panel>

      {/* 上線時間排行（全部玩家 · 總/平均/當期 · 清單/圖表） */}
      {presence && (
        <OnlineTimePanel
          presence={presence}
          players={data.players}
          avatarUrlFor={avatarUrlFor}
          onOpenPlayer={(name) => {
            const pl = data.players.find((x) => x.name === name);
            if (pl) setPlayerDlg(pl);
          }}
        />
      )}

      <OwnerDialog dlg={ownerDlg} totalPlayers={totalPlayers} onClose={() => setOwnerDlg(null)} onPlayerClick={onOwnerPlayerClick} />

      {playerDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPlayerDlg(null)}>
          <div className="max-h-[88dvh] w-full max-w-6xl overflow-y-auto rounded-xl border border-line bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">{playerDlg.name} · {t("帕魯（{n} 隻）", { n: playerDlg.pal_count })}</h2>
              <button onClick={() => setPlayerDlg(null)} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-card-soft hover:text-ink">✕</button>
            </div>
            <PalBrowser pals={playerDlg.pals.map((p): OwnedPal => ({ pal: p, owner: playerDlg }))} showOwner={false} onPalClick={onPalClick} />
          </div>
        </div>
      )}
    </div>
  );
}
