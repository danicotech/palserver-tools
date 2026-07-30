// 「上線分析」分頁：可下拉選全部玩家或單一玩家，查看上線時間的
// 時段分佈（上午/下午/晚上 + 24 小時）、星期分佈（週一~週日），與 總時間/平均/當期。
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Dataset } from "./data";
import { getPresence, type PresenceData, type PresencePlayer } from "./api";
import { SwitchChart } from "./charts";
import { OnlineDot, RankBar } from "./ui";
import { useRoster } from "./rosterCtx";
import { randomPalAvatar } from "./paldex";
import { t } from "../i18n";

const CYAN = "#06b6d4";
const VIOLET = "#8b5cf6";
const AMBER = "#f59e0b";

function fmtDur(sec: number): string {
  if (!sec || sec < 0) return t("{m} 分", { m: 0 });
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return t("{h} 時 {m} 分", { h, m });
  return t("{m} 分", { m });
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }): JSX.Element {
  return (
    <div className="rounded-cute bg-card p-4 shadow-cute ring-1 ring-line">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 text-xl font-bold" style={{ color: accent }}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="rounded-cute bg-card p-4 shadow-cute ring-1 ring-line">
      <div className="mb-3">
        <h3 className="font-semibold text-ink">{title}</h3>
        {desc && <p className="text-xs text-ink-muted">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export function OnlineAnalysis({ data }: { data: Dataset }): JSX.Element {
  const [presence, setPresence] = useState<PresenceData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string>(""); // "" = 全部玩家
  const [metric, setMetric] = useState<"total" | "avg" | "current">("total"); // 圖表統計口徑
  const { avatarUrlFor } = useRoster(); // 玩家自訂頭像(沒設就用固定隨機帕魯頭像)

  useEffect(() => {
    getPresence().then((p) => {
      setPresence(p);
      setLoaded(true);
    });
  }, []);

  // 下拉玩家名（合併玩家清單 + 追蹤資料）
  const names = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.players) if (p.name) s.add(p.name);
    for (const p of presence?.players ?? []) if (p.name) s.add(p.name);
    return [...s].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [data.players, presence]);

  // 聚合（全部或單一玩家）
  const agg = useMemo(() => {
    const hour = new Array(24).fill(0);
    const week = new Array(7).fill(0);
    let total = 0;
    let sessions = 0;
    let current = 0;
    let online = false;
    const list = (presence?.players ?? []).filter((p) => (sel ? p.name === sel : true));
    for (const p of list) {
      for (let i = 0; i < 24; i++) hour[i] += p.hourSecs?.[i] ?? 0;
      for (let i = 0; i < 7; i++) week[i] += p.weekSecs?.[i] ?? 0;
      total += p.onlineSeconds;
      sessions += p.sessions;
      current += p.currentSessionSeconds;
      online = online || p.online;
    }
    const avg = sessions ? Math.round(total / sessions) : 0;
    return { hour, week, total, avg, current, sessions, online, count: list.length };
  }, [presence, sel]);

  // 「全部玩家」時：列出每位玩家的上線時數貢獻(由多到少),點擊可切換為只看該玩家。
  const contributors = useMemo(() => {
    return (presence?.players ?? [])
      .filter((p) => p.onlineSeconds > 0)
      .map((p) => ({ name: p.name || t("（未知）"), userId: p.userId, total: p.onlineSeconds, online: p.online, sessions: p.sessions }))
      .sort((a, b) => b.total - a.total);
  }, [presence]);

  // 圖表資料(依 總/平均/當前 口徑):每個 bucket 算出小時數 + 該 bucket 是「哪些玩家 · 多少時間」。
  //   總  = 全部(選定)玩家在該時段的累計;
  //   平均 = 累計 / 玩家數(每位玩家平均);
  //   當前 = 只計目前在線的玩家。
  const chart = useMemo(() => {
    const selected = (presence?.players ?? []).filter((p) => (sel ? p.name === sel : true));
    const players = metric === "current" ? selected.filter((p) => p.online) : selected;
    const nP = players.length || 1;
    const build = (secsOf: (p: PresencePlayer) => number) => {
      const cs = players
        .map((p) => ({ name: p.name || t("（未知）"), secs: secsOf(p) }))
        .filter((c) => c.secs > 0)
        .sort((a, b) => b.secs - a.secs);
      const sum = cs.reduce((s, c) => s + c.secs, 0);
      const secs = metric === "avg" ? sum / nP : sum;
      return { hr: Math.round((secs / 3600) * 10) / 10, names: cs.map((c) => `${c.name} · ${fmtDur(c.secs)}`) };
    };
    const hour = Array.from({ length: 24 }, (_, i) => build((p) => p.hourSecs?.[i] ?? 0));
    const week = Array.from({ length: 7 }, (_, d) => build((p) => p.weekSecs?.[d] ?? 0));
    const rng = (p: PresencePlayer, a: number, b: number) => {
      let s = 0;
      for (let h = a; h < b; h++) s += p.hourSecs?.[h % 24] ?? 0;
      return s;
    };
    const period = [
      build((p) => rng(p, 6, 12)),
      build((p) => rng(p, 12, 18)),
      build((p) => rng(p, 18, 24) + rng(p, 0, 6)),
    ];
    return { hour, week, period, nPlayers: players.length };
  }, [presence, sel, metric]);

  const metricNote =
    metric === "avg" ? t("平均每位玩家") : metric === "current" ? t("僅目前在線({n} 人)", { n: chart.nPlayers }) : t("全部玩家累計");

  // 時段三分類：上午 06-12、下午 12-18、晚上 18-06（含凌晨）
  const periods = useMemo(() => {
    const sum = (a: number, b: number) => {
      let s = 0;
      for (let h = a; h < b; h++) s += agg.hour[h % 24];
      return s;
    };
    return { morning: sum(6, 12), afternoon: sum(12, 18), evening: sum(18, 24) + sum(0, 6) };
  }, [agg]);

  // 週一~週日（Go weekday 0=日..6=六）
  const weekOrder = [1, 2, 3, 4, 5, 6, 0];
  const weekLabels = [t("週一"), t("週二"), t("週三"), t("週四"), t("週五"), t("週六"), t("週日")];
  const toHr = (s: number) => Math.round((s / 3600) * 10) / 10;

  if (!loaded) return <div className="rounded-cute bg-card px-6 py-16 text-center text-ink-muted ring-1 ring-line">{t("載入上線資料中…")}</div>;
  if (!presence) return <div className="rounded-cute bg-card px-6 py-16 text-center text-ink-muted ring-1 ring-line">{t("後端未提供上線資料（需啟用 REST 追蹤）。")}</div>;

  const since = new Date(presence.trackingSince * 1000).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="space-y-5">
      {/* 玩家選擇 */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-ink-muted">{t("查詢對象")}</label>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="rounded-full border-2 border-line bg-card-soft px-4 py-2 text-base text-ink outline-none focus:border-pal sm:text-sm"
        >
          <option value="">{t("全部玩家（{n} 人）", { n: names.length })}</option>
          {names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">{t("自 {since} 起累計", { since })}</span>
      </div>

      {/* 統計數值 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("總上線時間")} value={fmtDur(agg.total)} sub={sel ? undefined : t("{n} 位玩家合計", { n: agg.count })} accent={CYAN} />
        <Tile label={t("平均每次上線")} value={fmtDur(agg.avg)} sub={t("共 {n} 次", { n: agg.sessions })} accent={VIOLET} />
        <Tile label={t("當期上線")} value={agg.online ? fmtDur(agg.current) : "—"} sub={agg.online ? t("目前在線") : t("目前離線")} accent={AMBER} />
        <Tile label={t("時段偏好")} value={maxPeriodLabel(periods)} sub={t("最常上線的時段")} accent={CYAN} />
      </div>

      {/* 各玩家上線時數貢獻（僅「全部玩家」時顯示） */}
      {!sel && contributors.length > 0 && (
        <Card title={t("各玩家上線時數貢獻（{n} 人）", { n: contributors.length })} desc={t("這些總時數由以下玩家累積而成 · 點任一玩家可切換為只看他的分析")}>
          <div data-seen="true" className="space-y-0.5">
            {contributors.map((c, i) => (
              <button
                key={c.name + i}
                onClick={() => setSel(c.name)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-card-soft/60"
                title={t("只看 {name} 的上線分析", { name: c.name })}
              >
                <span className={`w-6 shrink-0 text-center font-bold ${i < 3 ? "text-sun" : "text-ink-muted"}`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                </span>
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card-soft ring-1 ring-line">
                  <img src={avatarUrlFor(c.name) ?? randomPalAvatar(c.userId || c.name)} alt="" loading="lazy" className="h-full w-full object-cover" />
                </span>
                {c.online && <OnlineDot />}
                <span className="min-w-0 flex-1 truncate font-medium text-ink sm:w-40 sm:flex-none">{c.name}</span>
                <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">{t("{n} 次", { n: c.sessions })}</span>
                <RankBar pct={(c.total / contributors[0].total) * 100} delayMs={i * 40} color="bg-grass" className="min-w-0 flex-1" />
                <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{fmtDur(c.total)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 單一玩家時：提供返回全部的捷徑 */}
      {sel && (
        <button
          onClick={() => setSel("")}
          className="text-sm font-semibold text-pal underline-offset-2 hover:underline"
        >
          ← {t("返回全部玩家")}
        </button>
      )}

      {/* 圖表統計口徑:總 / 平均 / 當前(影響下面三張分佈圖);滑到點上會列出是哪些玩家 + 各自時間。 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{t("圖表統計")}</span>
        <div className="flex gap-0.5 rounded-full bg-card-soft p-0.5 ring-1 ring-line">
          {([["total", t("總")], ["avg", t("平均")], ["current", t("當前")]] as [typeof metric, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMetric(k)}
              className={`rounded-full px-3.5 py-1 text-sm font-medium transition ${metric === k ? "bg-pal text-white" : "text-ink-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">{t("{note} · 滑到點上看是哪些玩家", { note: metricNote })}</span>
      </div>

      {/* 時段分佈（上午/下午/晚上） */}
      <Card title={t("時段分佈")} desc={t("上午 06–12 · 下午 12–18 · 晚上 18–06（含凌晨）")}>
        <SwitchChart
          fill
          kinds={["line", "bar"]}
          labels={[t("上午"), t("下午"), t("晚上")]}
          values={chart.period.map((x) => x.hr)}
          tooltipItems={chart.period.map((x) => x.names)}
          primary={CYAN}
          unit={t(" 小時")}
        />
      </Card>

      {/* 24 小時分佈 */}
      <Card title={t("每小時分佈（24 小時）")} desc={t("每個整點的上線時數")}>
        <SwitchChart
          fill
          kinds={["line", "bar"]}
          labels={Array.from({ length: 24 }, (_, h) => t("{h}時", { h }))}
          values={chart.hour.map((x) => x.hr)}
          tooltipItems={chart.hour.map((x) => x.names)}
          primary={VIOLET}
          unit={t(" 小時")}
        />
      </Card>

      {/* 星期分佈（週一~週日） */}
      <Card title={t("星期分佈")} desc={t("週一到週日各自的上線時數")}>
        <SwitchChart
          fill
          kinds={["line", "bar"]}
          labels={weekLabels}
          values={weekOrder.map((d) => chart.week[d].hr)}
          tooltipItems={weekOrder.map((d) => chart.week[d].names)}
          primary={AMBER}
          unit={t(" 小時")}
        />
      </Card>
    </div>
  );
}

function maxPeriodLabel(p: { morning: number; afternoon: number; evening: number }): string {
  const arr: [string, number][] = [[t("上午"), p.morning], [t("下午"), p.afternoon], [t("晚上"), p.evening]];
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][1] > 0 ? arr[0][0] : "—";
}
