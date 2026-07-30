import { useEffect, useState } from "react";
import { FiX, FiShield } from "react-icons/fi";
import { Markdown } from "./Markdown";
import { t, useI18n } from "./i18n";
import { Overlay, card, btn } from "./ui";

/**
 * 隱私權政策彈窗:顯示 /privacy.md 的政策全文。
 * 遙測開關在「設定」裡(需要已連線的 agent),這裡純資訊。
 */
export function PrivacyModal({ onClose }: { onClose: () => void }) {
  useI18n();
  const [policy, setPolicy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/privacy.md", { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setPolicy)
      .catch(() => setPolicy(t("讀取失敗 —— 政策全文請見專案的 PRIVACY.md。")));
  }, []);

  return (
    <Overlay onClose={onClose}>
      <div
        className={`${card} flex max-h-[85dvh] w-[560px] max-w-full flex-col gap-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-extrabold">
            <FiShield className="size-5 text-pal" /> {t("隱私權政策")}
          </h2>
          <button className="text-ink-muted transition hover:text-ink" onClick={onClose} aria-label={t("關閉")}>
            <FiX className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-[13px]">
          {policy === null ? <p className="text-ink-muted">{t("載入中…")}</p> : <Markdown source={policy} />}
        </div>

        <div className="flex justify-end">
          <button className={btn} onClick={onClose}>
            {t("我知道了")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
