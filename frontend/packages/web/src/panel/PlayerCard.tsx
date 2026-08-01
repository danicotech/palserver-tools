// 玩家卡：角色摘要（可摺疊）+ 共用帕魯瀏覽器（完整篩選/排序）。
import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Pal, Player } from "./types";
import type { OwnedPal } from "./data";
import { Chip, fmtNum, OnlineDot } from "./ui";
import { PalBrowser } from "./PalBrowser";
import { usePlayerAvatar, playerInitial } from "./playerAvatar";
import { t } from "../i18n";

export function PlayerCard({
  player,
  online = false,
  onPalClick,
  defaultOpen = true,
  initialPalQuery,
}: {
  player: Player;
  online?: boolean;
  onPalClick: (p: Pal, owner?: Player) => void;
  defaultOpen?: boolean;
  initialPalQuery?: string; // 進場時只顯示此帕魯（可於瀏覽器內清除）
}): JSX.Element {
  const sp = player.status_points;
  const [open, setOpen] = useState(defaultOpen);
  const owned = useMemo<OwnedPal[]>(() => player.pals.map((p) => ({ pal: p, owner: player })), [player]);
  // 頭像跟右上角「設定頭像」連動;沒設定才用固定備援(與總覽同一條規則)
  const avatarOf = usePlayerAvatar();
  const avatar = useMemo(() => avatarOf(player), [avatarOf, player]);

  return (
    <div className={`overflow-hidden rounded-2xl bg-card ring-1 ${online ? "ring-2 ring-grass" : "ring-line"}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`block w-full border-b border-line bg-gradient-to-r ${online ? "from-grass/25" : "from-pal/30"} to-transparent p-4 text-left`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
            {/* 左上頭像:與地圖標記、總覽用同一份規則(playerAvatar) */}
            <span
              className={`inline-flex size-9 shrink-0 items-center justify-center self-center overflow-hidden rounded-full bg-card-soft ring-2 ${
                online ? "ring-grass" : "ring-line"
              }`}
            >
              {avatar ? (
                <img src={avatar} alt="" className="size-full object-cover" />
              ) : (
                <b className="text-sm text-ink-muted">{playerInitial(player)}</b>
              )}
            </span>
            <span>{open ? "▾" : "▸"} {player.name}</span>
            {online && (
              <span className="inline-flex items-center gap-1 rounded-full bg-grass/20 px-2 py-0.5 text-xs font-medium text-grass ring-1 ring-grass/40">
                <OnlineDot />
                {t("在線")}
              </span>
            )}
          </h2>
          <span className="font-mono text-xs text-ink-muted">{player.uid}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip tone="amber">Lv {player.level}</Chip>
          <Chip>EXP {fmtNum(player.exp)}</Chip>
          <Chip>HP {fmtNum(player.hp)}</Chip>
          <Chip>{t("護盾")} {fmtNum(player.shield_hp)}</Chip>
          <Chip tone="sky">{t("帕魯 {n} 隻", { n: player.pal_count })}</Chip>
          {player.unused_status_point > 0 && <Chip tone="rose">{t("未配點")} {player.unused_status_point}</Chip>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>HP {sp.hp}</span>
          <span>{t("耐力")} {sp.stamina}</span>
          <span>{t("攻擊")} {sp.attack}</span>
          <span>{t("重量")} {sp.weight}</span>
          <span>{t("捕獲")} {sp.capture}</span>
          <span>{t("工作速度")} {sp.workspeed}</span>
        </div>
      </button>

      {open && (
        <div className="p-4">
          <PalBrowser pals={owned} showOwner={false} onPalClick={onPalClick} initialQuery={initialPalQuery} />
        </div>
      )}
    </div>
  );
}
