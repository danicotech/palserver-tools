import { useCallback, useEffect, useState } from "react";
import { FiDownload, FiPlus, FiRefreshCw, FiRotateCw, FiShield } from "react-icons/fi";
import type { ConfigSnapshotFileName } from "@palserver/shared";
import type { AgentClient } from "./api";
import { t, useI18n } from "./i18n";
import { btn, btnGhost, card, errorCls, inputCls } from "./ui";

const SNAPSHOT_FILES: ConfigSnapshotFileName[] = ["PalWorldSettings.ini", "Engine.ini"];

type Snapshot = Awaited<ReturnType<AgentClient["listConfigBackups"]>>["snapshots"][number];

function hasFile(snapshot: Snapshot, name: ConfigSnapshotFileName): boolean {
  const files = snapshot.files as Partial<Record<ConfigSnapshotFileName, string | null>> | null | undefined;
  return files?.[name] != null;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ConfigBackupPanel({
  client,
  instanceId,
  restoreAllowed,
}: {
  client: AgentClient;
  instanceId: string;
  restoreAllowed: boolean;
}) {
  useI18n();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listConfigBackups(instanceId);
      setSnapshots(result.snapshots ?? []);
      setSupported(result.supported);
      if (!result.supported) setError(result.reason ?? t("設定快照目前不支援此實例"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, instanceId]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  const createSnapshot = async () => {
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const result = await client.createConfigBackup(instanceId, reason);
      if (!result.supported || !result.snapshot) {
        setError(result.reason ?? t("無法建立設定快照"));
        return;
      }
      setReason("");
      setNotice(t("已建立設定快照：{id}", { id: result.snapshot.id }));
      await loadSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const restoreSnapshot = async (snapshot: Snapshot) => {
    const confirmed = window.confirm(
      t(
        "確定要還原設定快照 {id} 嗎？還原前會先建立 safety snapshot。還原不會套用到 Kubernetes env，完成後仍需重啟伺服器或執行 rollout。",
        { id: snapshot.id },
      ),
    );
    if (!confirmed) return;

    setBusy(`restore:${snapshot.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await client.restoreConfigBackup(instanceId, snapshot.id);
      if (!result.supported) {
        setError(result.reason ?? t("無法還原設定快照"));
        return;
      }
      const safetyId = result.safetySnapshot?.id ?? t("未回傳");
      setNotice(
        t(
          "設定快照已還原；safety snapshot：{id}。這不代表已套用到 Kubernetes env，請重啟伺服器或對 StatefulSet 執行 rollout。",
          { id: safetyId },
        ),
      );
      await loadSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${card} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <FiShield className="size-4 text-pal" /> {t("INI 設定快照")}
          </h2>
          <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-ink-muted">
            {t("快照保存 PalWorldSettings.ini 與 Engine.ini；不代表已套用到 Kubernetes env。還原後需重啟伺服器或執行 rollout。")}
          </p>
          <p className="mt-1 text-xs font-semibold text-ink-muted">
            {restoreAllowed
              ? t("目前狀態符合此後端的還原要求。")
              : t("還原前請依後端要求調整伺服器執行狀態。")}
          </p>
        </div>
        <button
          type="button"
          className={`${btnGhost} inline-flex items-center gap-1.5`}
          onClick={() => void loadSnapshots()}
          disabled={loading || busy !== null}
        >
          <FiRefreshCw className="size-4" /> {t("重新整理")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-line bg-card-soft p-3">
        <label className="min-w-60 flex-1 text-xs font-extrabold text-ink-muted">
          {t("手動建立快照原因（可選）")}
          <input
            className={`${inputCls} mt-1 w-full`}
            value={reason}
            maxLength={120}
            placeholder={t("例如：更新前")}
            onChange={(event) => setReason(event.target.value)}
            disabled={!supported || busy !== null}
          />
        </label>
        <button
          type="button"
          className={`${btn} inline-flex items-center gap-1.5`}
          onClick={() => void createSnapshot()}
          disabled={!supported || busy !== null}
        >
          <FiPlus className="size-4" /> {busy === "create" ? t("建立中…") : t("建立快照")}
        </button>
      </div>

      {notice && <p className="rounded-xl bg-grass/10 px-3 py-2 text-[13px] font-bold text-grass">{notice}</p>}
      {error && <p className={errorCls}>{error}</p>}

      {loading ? (
        <p className="text-sm font-semibold text-ink-muted">{t("讀取快照中…")}</p>
      ) : snapshots.length === 0 ? (
        <p className="text-sm font-semibold text-ink-muted">{t("目前沒有設定快照")}</p>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-64 flex-1">
                <p className="break-all text-sm font-extrabold">{snapshot.id}</p>
                <p className="text-xs font-semibold text-ink-muted">
                  {formatCreatedAt(snapshot.createdAt)} · {snapshot.reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SNAPSHOT_FILES.map((name) => (
                    <span
                      key={name}
                      className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${
                        hasFile(snapshot, name) ? "bg-grass/15 text-grass" : "bg-berry/10 text-berry"
                      }`}
                    >
                      {name}: {hasFile(snapshot, name) ? t("存在") : t("不存在")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  className={`${btnGhost} inline-flex items-center gap-1.5`}
                  href={client.configBackupDownloadUrl(instanceId, snapshot.id)}
                >
                  <FiDownload className="size-4" /> {t("下載")}
                </a>
                <button
                  type="button"
                  className={`${btnGhost} inline-flex items-center gap-1.5`}
                  onClick={() => void restoreSnapshot(snapshot)}
                  disabled={busy !== null || !restoreAllowed}
                >
                  <FiRotateCw className="size-4" />
                  {busy === `restore:${snapshot.id}` ? t("還原中…") : t("還原")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
