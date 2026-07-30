// 共用的帕魯卡片：左側圓形頭像 + 名稱、屬性、等級、星級、α/稀有、暱稱、IV、詞條。
// 頭像與正確繁中名取自內建圖鑑（paldex）；可選 owner 顯示擁有者。
import type { JSX } from "react";
import type { Pal } from "./types";
import { ElementBadge, RankStars, Chip, WorkIcon } from "./ui";
import { palInfo, localizeTrait, localizeWork } from "./paldex";

export function PalTile({
  pal,
  owner,
  onClick,
}: {
  pal: Pal;
  owner?: string;
  onClick: () => void;
}): JSX.Element {
  const info = palInfo(pal.species);
  const name = info.zh || pal.name_zh;

  return (
    <button
      onClick={onClick}
      className="group flex gap-3 rounded-cute bg-card-soft p-3 text-left ring-1 ring-line transition hover:-translate-y-px hover:shadow-cute hover:ring-pal/60"
    >
      {/* 左側圓形頭像（挖洞） */}
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-sky-soft ring-2 ring-line group-hover:ring-pal/60">
        {info.iconUrl ? (
          <img
            src={info.iconUrl}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg text-ink-muted">
            🐾
          </div>
        )}
      </div>

      {/* 右側內容 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-ink group-hover:text-pal">{name}</span>
          <RankStars rank={pal.rank} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {pal.elements.map((e) => (
            <ElementBadge key={e} el={e} />
          ))}
          <span className="text-xs text-ink-muted">Lv {pal.level}</span>
          {pal.is_alpha && <Chip tone="rose">α</Chip>}
          {pal.is_lucky && <Chip tone="amber">✦</Chip>}
        </div>
        {owner && <div className="truncate text-xs text-pal">👤 {owner}</div>}
        {pal.nickname && (
          <div className="truncate text-xs italic text-sun">「{pal.nickname}」</div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span className="shrink-0">IV {pal.iv_hp}/{pal.iv_attack}/{pal.iv_defense}</span>
          {/* 工作適應性：paldb 風格緊湊圖示 + 等級 */}
          {Object.entries(pal.work).map(([w, lv]) => (
            <span key={w} className="inline-flex items-center gap-0.5" title={`${localizeWork(w)} Lv${lv}`}>
              <WorkIcon work={w} size={15} />
              <span className="tabular-nums">{lv}</span>
            </span>
          ))}
        </div>
        {pal.passives.length > 0 && (
          <div className="mt-0.5 flex flex-nowrap gap-1 overflow-x-auto">
            {pal.passives.map((pv, i) => (
              <span
                key={i}
                className="shrink-0 whitespace-nowrap rounded bg-pal/10 px-1.5 py-0.5 text-[11px] leading-tight text-pal ring-1 ring-pal/25"
              >
                {localizeTrait(pv)}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
