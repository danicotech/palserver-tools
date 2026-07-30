// 連線設定 modal（全域）：設定 palscheduler 後端 URL + token。
import { useState } from "react";
import type { JSX } from "react";
import { loadConnection, saveConnection, clearConnection, probe } from "./api";
import { t } from "../i18n";

export function ConnectModal({ onClose }: { onClose: () => void }): JSX.Element {
  const existing = loadConnection();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "http://localhost:9000");
  const [token, setToken] = useState(existing?.token ?? "");
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(t("測試連線中…"));
    const ok = await probe({ baseUrl, token });
    if (!ok) {
      setStatus(t("⚠️ 連不到後端（/healthz 無回應），請確認 URL。"));
      return;
    }
    saveConnection({ baseUrl, token });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-bold text-white">{t("連線設定")}</h2>
        <p className="mb-4 text-sm text-ink-muted">
          {t("留空＝使用面板內建後端（同源代理，免 token，外部只需開 8080）。填入則改打你指定的 palscheduler 位址（需帶 token）。")}
        </p>
        <label className="mb-1 block text-xs text-ink-muted">{t("後端 URL")}</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://伺服器IP:9000"
          className="mb-3 w-full rounded-lg bg-card-soft px-3 py-2 text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
        />
        <label className="mb-1 block text-xs text-ink-muted">API Token</label>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          className="mb-4 w-full rounded-lg bg-card-soft px-3 py-2 text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-pal"
        />
        {status && <div className="mb-3 text-sm text-sun">{status}</div>}
        <div className="flex justify-between gap-2">
          <button
            onClick={() => {
              clearConnection();
              onClose();
            }}
            className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-card-soft"
          >
            {t("清除（用離線素材）")}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-ink hover:bg-card-soft">
              {t("取消")}
            </button>
            <button onClick={save} className="rounded-lg bg-pal px-4 py-2 text-sm font-semibold text-white hover:bg-pal">
              {t("儲存並連線")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
