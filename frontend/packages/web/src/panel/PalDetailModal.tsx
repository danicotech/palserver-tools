// 帕魯詳情彈窗：點擊某隻帕魯後顯示完整資訊。
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import { ElementBadge, RankStars, IvBar, Chip, fmtNum, WorkChip } from "./ui";
import { palInfo, localizeTrait } from "./paldex";
import { t } from "../i18n";

function SkillList({
  title,
  skills,
  onFilter,
}: {
  title: string;
  skills: string[];
  onFilter?: (f: { trait?: string; work?: string; query?: string }) => void;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-muted">{title}</div>
      {skills.length === 0 ? (
        <div className="text-xs text-ink-muted">—</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s, i) => (
            <button
              key={i}
              onClick={() => onFilter?.({ trait: s })}
              title={t("點擊 → 帕魯查詢此技能")}
              className="rounded-md bg-line/60 px-2 py-1 text-xs text-ink transition hover:bg-pal hover:text-white"
            >
              {localizeTrait(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PalDetailModal({
  pal,
  owner,
  onClose,
  onFilter,
  onOwnerClick,
}: {
  pal: Pal;
  owner?: Player;
  onClose: () => void;
  onFilter?: (f: { trait?: string; work?: string; query?: string }) => void;
  onOwnerClick?: (name: string) => void;
}): JSX.Element {
  const soul = pal.souls;
  const info = palInfo(pal.species);
  const name = info.zh || pal.name_zh;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card bg-card p-5 shadow-2xl ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標題列 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {/* 頭像 */}
            <span className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-sky-soft ring-2 ring-line">
              {info.iconUrl ? (
                <img src={info.iconUrl} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl text-ink-muted">🐾</span>
              )}
            </span>
            <div>
              <div className="flex items-center gap-2">
                {onFilter ? (
                  <button
                    onClick={() => onFilter({ query: name })}
                    title={t("點擊 → 帕魯查詢所有同種帕魯")}
                    className="text-xl font-bold text-ink underline decoration-dotted decoration-pal/50 underline-offset-4 hover:text-pal"
                  >
                    {name}
                  </button>
                ) : (
                  <h2 className="text-xl font-bold text-ink">{name}</h2>
                )}
                {pal.is_alpha && <Chip tone="rose">{t("α / 首領")}</Chip>}
                {pal.is_lucky && <Chip tone="amber">{t("✦ 稀有")}</Chip>}
              </div>
              <div className="text-sm text-ink-muted">
                {pal.name_en}
                {pal.paldeck && ` · No.${pal.paldeck}`}
              </div>
              {pal.nickname && <div className="mt-1 text-sm italic text-sun">「{pal.nickname}」</div>}
              {owner &&
                (onOwnerClick ? (
                  <button
                    onClick={() => onOwnerClick(owner.name)}
                    title={t("點擊 → 玩家查詢")}
                    className="mt-1 text-sm font-medium text-pal underline decoration-dotted underline-offset-2 hover:text-pal/80"
                  >
                    👤 {t("持有玩家：{name}", { name: owner.name })}
                  </button>
                ) : (
                  <div className="mt-1 text-sm font-medium text-pal">👤 {t("持有玩家：{name}", { name: owner.name })}</div>
                ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-ink-muted hover:bg-line hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* 基本資訊 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {pal.elements.map((e) => (
            <ElementBadge key={e} el={e} />
          ))}
          <Chip>Lv {pal.level}</Chip>
          <RankStars rank={pal.rank} />
          <Chip>{pal.gender === "Male" ? "♂" : pal.gender === "Female" ? "♀" : "—"}</Chip>
        </div>

        {/* 數值格 */}
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="HP" value={fmtNum(pal.hp)} />
          <Stat label={t("好感度")} value={fmtNum(pal.friendship)} />
          <Stat label={t("經驗")} value={fmtNum(pal.exp)} />
          <Stat label={t("飽食度")} value={String(pal.stomach)} />
        </div>

        {/* 個體值 */}
        <div className="mb-4 space-y-1.5 rounded-xl bg-card-soft/60 p-3">
          <div className="mb-1 text-xs font-semibold text-ink-muted">{t("個體值 (IV)")}</div>
          <IvBar label="HP" value={pal.iv_hp} />
          <IvBar label={t("攻擊")} value={pal.iv_attack} />
          <IvBar label={t("防禦")} value={pal.iv_defense} />
        </div>

        {/* 靈魂強化 */}
        <div className="mb-4 grid grid-cols-4 gap-2 rounded-xl bg-card-soft/60 p-3 text-center">
          <SoulStat label="HP" v={soul.hp} />
          <SoulStat label={t("攻擊")} v={soul.attack} />
          <SoulStat label={t("防禦")} v={soul.defense} />
          <SoulStat label={t("工作")} v={soul.craftspeed} />
        </div>

        {/* 技能 */}
        <div className="space-y-3">
          <SkillList title={t("已裝備主動技能")} skills={pal.active_skills} onFilter={onFilter} />
          <SkillList title={t("已習得主動技能")} skills={pal.mastered_skills} onFilter={onFilter} />
          <div>
            <div className="mb-1 text-xs font-semibold text-ink-muted">{t("被動技能")}</div>
            <div className="flex flex-wrap gap-1.5">
              {pal.passives.length === 0 ? (
                <span className="text-xs text-ink-muted">—</span>
              ) : (
                pal.passives.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => onFilter?.({ trait: p })}
                    title={t("點擊 → 帕魯查詢此詞條")}
                    className="rounded-md bg-pal/20 px-2 py-1 text-xs text-pal ring-1 ring-pal/30 transition hover:bg-pal hover:text-white"
                  >
                    {localizeTrait(p)}
                  </button>
                ))
              )}
            </div>
          </div>
          {Object.keys(pal.work).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-ink-muted">{t("工作適性")}</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(pal.work).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => onFilter?.({ work: k })}
                    title={t("點擊 → 帕魯查詢此工作適性")}
                    className="rounded-lg transition hover:ring-2 hover:ring-pal"
                  >
                    <WorkChip work={k} level={v} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-card-soft/60 px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function SoulStat({ label, v }: { label: string; v: number }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`font-bold tabular-nums ${v > 0 ? "text-pal" : "text-ink-muted"}`}>
        +{v}%
      </div>
    </div>
  );
}
