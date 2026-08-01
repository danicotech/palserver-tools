// 變異路線的產蛋設定 —— 蛋糕/牧場/加成三項原本各佔一排按鈕,整合成一顆
// 顯示目前設定的按鈕,點開才展開細項;突變的固定加成與彩虹詞條也收在同一個面板裡,
// 平常只留一個 ⓘ,不再佔用主畫面。
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  CAKES,
  FARMS,
  MUTATION_PERKS,
  MUTATION_PASSIVES,
  type CakeKind,
  type FarmKind,
} from "../mutationTable";
import { t, useI18n } from "../i18n";

export function MutationSettings({
  cake,
  setCake,
  farm,
  setFarm,
  boosted,
  setBoosted,
  icon,
}: {
  cake: CakeKind;
  setCake: (v: CakeKind) => void;
  farm: FarmKind;
  setFarm: (v: FarmKind) => void;
  boosted: boolean;
  setBoosted: (v: boolean) => void;
  /** 變異帕魯圖示路徑(說明區用) */
  icon: string;
}): JSX.Element {
  useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const summary = `${t(CAKES[cake].label)} ${Math.round(CAKES[cake].rate * 100)}% · ${t(FARMS[farm].label)}${
    boosted ? ` · ${t("有加成")}` : ""
  }`;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("設定蛋糕、產蛋設施與加成")}
        className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap ring-1 transition sm:text-sm ${
          open ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink ring-line hover:ring-pal"
        }`}
      >
        ⚙ {summary} <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute top-12 left-0 z-30 w-80 max-w-[90vw] rounded-cute bg-card p-3 shadow-cute ring-1 ring-line">
          <Section label={t("蛋糕")}>
            {(Object.keys(CAKES) as CakeKind[]).map((k) => (
              <Opt key={k} on={cake === k} onClick={() => setCake(k)} note={t(CAKES[k].note)}>
                {t(CAKES[k].label)} <b>{Math.round(CAKES[k].rate * 100)}%</b>
              </Opt>
            ))}
          </Section>

          <Section label={t("產蛋設施")}>
            {(Object.keys(FARMS) as FarmKind[]).map((k) => (
              <Opt
                key={k}
                on={farm === k}
                onClick={() => setFarm(k)}
                note={t("{n} 秒一顆蛋", { n: FARMS[k].base })}
              >
                {t(FARMS[k].label)}
              </Opt>
            ))}
          </Section>

          <label className="mt-2 flex items-center gap-2 rounded-lg bg-card-soft px-2.5 py-2 text-sm text-ink ring-1 ring-line">
            <input type="checkbox" checked={boosted} onChange={(e) => setBoosted(e.target.checked)} />
            <span className="min-w-0">
              {t("梁葉龍/寶寶保母")}
              <span className="ml-1 text-[11px] text-ink-muted">{t("兩者效果不可疊加,取高者")}</span>
            </span>
          </label>

          <details className="mt-2 rounded-lg bg-card-soft px-2.5 py-2 text-[11px] ring-1 ring-line">
            <summary className="cursor-pointer font-bold text-ink-muted">
              <img src={icon} alt="" className="mr-1 inline-block size-3.5 align-[-2px]" />
              {t("突變帕魯會拿到什麼?")}
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {MUTATION_PERKS.map((x) => (
                <span key={x} className="rounded bg-grass/12 px-1.5 py-0.5 font-semibold text-grass">
                  {t(x)}
                </span>
              ))}
            </div>
            <p className="mt-1.5 font-bold text-ink-muted">🌈 {t("突變專屬彩虹詞條")}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {MUTATION_PASSIVES.map((x) => (
                <span key={x} className="rounded bg-berry/12 px-1.5 py-0.5 font-semibold text-berry">
                  {x}
                </span>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-2">
      <p className="mb-1 text-[11px] font-bold text-ink-muted">{label}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Opt({
  on,
  onClick,
  note,
  children,
}: {
  on: boolean;
  onClick: () => void;
  note?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ring-1 transition ${
        on ? "bg-pal text-white ring-pal" : "bg-card-soft text-ink ring-line hover:ring-pal"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {note && <span className={`shrink-0 text-[11px] ${on ? "text-white/80" : "text-ink-muted"}`}>{note}</span>}
    </button>
  );
}
