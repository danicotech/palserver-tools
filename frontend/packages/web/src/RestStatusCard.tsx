import { useEffect, useState } from "react";
import { FiServer, FiKey, FiCheck } from "react-icons/fi";
import type { PdRestStatus } from "@palserver/shared";
import { card, btn, btnGhost, inputCls } from "./ui";
import { t } from "./i18n";

/** PalDefender REST API status: a toggle to enable it (which unlocks player
 * detail) and a button to provision the access token — no raw file editing
 * needed. Shared by the PalDefender tab and the player-detail modal (so a
 * failed lookup can be fixed on the spot). Renders nothing until PalDefender
 * itself is installed. */
export function RestStatusCard({
  rest,
  onToggle,
  onProvisionToken,
  onSetPort,
}: {
  rest: PdRestStatus | null;
  onToggle: (enabled: boolean) => void;
  onProvisionToken: () => void;
  onSetPort?: (port: number) => void;
}) {
  const [portDraft, setPortDraft] = useState(String(rest?.port ?? 17993));
  useEffect(() => {
    if (rest) setPortDraft(String(rest.port));
  }, [rest?.port]);

  if (!rest || !rest.installed) return null;

  const portNum = Number(portDraft);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;

  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-extrabold">
          <FiServer className="size-4 text-pal" /> PalDefender REST API
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={rest.enabled}
          aria-label={t("啟用 REST API")}
          onClick={() => rest.configExists && onToggle(!rest.enabled)}
          disabled={!rest.configExists}
          className={`relative h-7 w-12 rounded-full transition disabled:opacity-40 ${rest.enabled ? "bg-grass" : "bg-line"}`}
        >
          <span
            className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${rest.enabled ? "left-6" : "left-1"}`}
          />
        </button>
      </div>

      <p className="text-[13px] text-ink-muted">
        {!rest.configExists
          ? rest.reason ?? t("尚未生成 REST 設定 — 啟動一次伺服器即會產生。")
          : rest.enabled
            ? t("啟用後,可在玩家分頁點玩家查看其帕魯與背包。變更需重啟伺服器才會生效。")
            : t("啟用後,可在玩家分頁點玩家查看其帕魯與背包。")}
      </p>

      {rest.configExists && onSetPort && (
        <div className="flex flex-wrap items-center gap-2 border-t-2 border-line pt-3">
          <span className="text-[13px] font-bold">{t("REST API 端口")}</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            className={`${inputCls} w-28`}
          />
          <button
            className={`${btnGhost} inline-flex items-center gap-1.5`}
            disabled={!portValid || portNum === rest.port}
            onClick={() => onSetPort(portNum)}
          >
            {t("儲存端口")}
          </button>
          <span className="text-xs text-ink-muted">{t("預設 17993;變更需重啟伺服器生效。")}</span>
        </div>
      )}

      {rest.enabled && rest.configExists && (
        <div className="flex flex-wrap items-center gap-3 border-t-2 border-line pt-3">
          <span className="text-[13px] font-bold">
            {t("存取權杖:")}
            {rest.hasToken ? (
              <span className="ml-1 inline-flex items-center gap-1 text-grass">
                <FiCheck className="size-3.5" /> {t("已設定")}
              </span>
            ) : (
              <span className="ml-1 text-sun">{t("尚未設定")}</span>
            )}
          </span>
          <button
            className={`${rest.hasToken ? btnGhost : btn} inline-flex items-center gap-1.5`}
            onClick={onProvisionToken}
          >
            <FiKey className="size-4" /> {rest.hasToken ? t("重新產生權杖") : t("建立存取權杖")}
          </button>
          <span className="text-xs text-ink-muted">{t("agent 用它讀取玩家資料,只在本機使用。")}</span>
        </div>
      )}
    </div>
  );
}
