// 上傳自己的 Level.sav 直接看數據(給單機/自架玩家用)。
//
// 為什麼要有這個:面板原本只能看「這台伺服器」的存檔。單機玩家或別人的伺服器
// 沒辦法把面板架起來,但他們手上就有一份 Level.sav —— 拖進來就能用同一套分析。
//
// 資料怎麼處理:
//   - 存檔上傳後在後端「只在記憶體裡」解析,伺服器磁碟上不留任何副本
//   - 解析結果放瀏覽器的 sessionStorage,關掉分頁就消失
//   - 隨時可以切回伺服器資料,兩邊互不影響
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { FiUploadCloud, FiFile, FiX, FiAlertTriangle, FiServer, FiHardDrive } from "react-icons/fi";
import { analyzeSave } from "./api";
import { setLocalSave, isLocalMode } from "./data";
import type { PalsResponse } from "./types";
import { t } from "../i18n";

const MB = 1024 * 1024;

/** 上傳區塊。onLoaded 在解析成功後呼叫,讓外層切換畫面。 */
export function SaveUpload({ onLoaded }: { onLoaded: () => void }): JSX.Element {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  const handle = useCallback(
    async (file: File) => {
      setErr(null);
      setNote(null);
      // 只擋明顯不對的:副檔名不是 .sav 就先問一下,但不硬性拒絕 ——
      // 有些人會把檔案改名,真正的把關在後端的格式檢查。
      if (!/\.sav$/i.test(file.name)) {
        setNote(t("這個檔案不是 .sav,仍會嘗試解析"));
      }
      setBusy(true);
      setProgress(0);
      try {
        const resp: PalsResponse = await analyzeSave(file, (r) => {
          if (aliveRef.current) setProgress(r);
        });
        if (!aliveRef.current) return;
        if (!resp.players?.length) {
          setErr(t("解析成功,但這份存檔裡沒有任何玩家資料"));
          return;
        }
        setLocalSave(resp);
        onLoaded();
      } catch (e) {
        if (aliveRef.current) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setBusy(false);
      }
    },
    [onLoaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handle(f);
    },
    [handle],
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h2 className="text-lg font-bold text-ink">{t("分析我自己的存檔")}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {t("把 Level.sav 拖進下面的框，就能用這個面板的全部功能看自己的世界。")}
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? "border-pal bg-pal/10" : "border-line bg-card-soft hover:border-pal/60"
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <FiUploadCloud size={44} className={drag ? "text-pal" : "text-ink-muted"} />
        <p className="mt-3 text-sm font-semibold text-ink">
          {busy ? t("解析中…") : t("把 Level.sav 拖到這裡，或點擊選擇檔案")}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {t("通常在 …\\Pal\\Saved\\SaveGames\\0\\<一長串英數>\\Level.sav")}
        </p>
        {busy && (
          <div className="mt-4 w-full max-w-sm">
            {/* 上傳有進度、解析沒有 —— 傳完就把條走滿並改字，免得看起來卡住 */}
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-pal transition-[width]"
                style={{ width: `${Math.max(4, progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {progress < 1
                ? t("上傳中 {n}%", { n: Math.round(progress * 100) })
                : t("伺服器解析中（大存檔約需十幾秒）")}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".sav"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f);
            e.target.value = ""; // 允許重選同一個檔
          }}
        />
      </div>

      {note && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-sun">
          <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
          {note}
        </p>
      )}
      {err && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-berry/10 px-3 py-2 text-sm text-berry">
          <FiAlertTriangle size={16} className="mt-0.5 shrink-0" />
          {err}
        </p>
      )}

      {/* 講清楚檔案去哪了 —— 上傳自己的存檔到別人的網站,會擔心是正常的 */}
      <div className="mt-6 rounded-xl bg-card-soft px-4 py-3 text-xs leading-relaxed text-ink-muted ring-1 ring-line">
        <p className="mb-1 font-semibold text-ink">{t("你的存檔會怎麼被處理")}</p>
        <ul className="space-y-1">
          <li>{t("・解析全程在記憶體完成，伺服器硬碟上不會留下任何副本")}</li>
          <li>{t("・結果只存在你的瀏覽器分頁裡，關掉分頁就消失")}</li>
          <li>{t("・不會寫入或影響這台伺服器原本的存檔資料")}</li>
          <li>{t("・單一檔案上限 512 MB")}</li>
        </ul>
      </div>
    </div>
  );
}

/** 目前資料來源的橫幅 + 切換鈕。本地模式時常駐在頁面頂端。 */
export function SaveSourceBar({
  localName,
  onSwitchToServer,
  onOpenUpload,
}: {
  localName?: string;
  onSwitchToServer: () => void;
  onOpenUpload: () => void;
}): JSX.Element | null {
  const local = isLocalMode();
  if (!local) {
    return (
      <button
        type="button"
        onClick={onOpenUpload}
        className="flex items-center gap-1.5 rounded-lg bg-card-soft px-2.5 py-1.5 text-xs text-ink-muted ring-1 ring-line transition hover:text-ink hover:ring-pal"
        title={t("分析我自己的存檔")}
      >
        <FiHardDrive size={14} />
        <span className="hidden sm:inline">{t("分析我自己的存檔")}</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-sun/15 px-2.5 py-1.5 text-xs text-ink ring-1 ring-sun/50">
      <FiFile size={14} className="shrink-0 text-sun" />
      <span className="max-w-40 truncate font-semibold">
        {localName || t("上傳的存檔")}
      </span>
      <button
        type="button"
        onClick={onSwitchToServer}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-muted transition hover:bg-card hover:text-ink"
        title={t("切回伺服器資料")}
      >
        <FiServer size={13} />
        <span className="hidden sm:inline">{t("切回伺服器")}</span>
        <FiX size={13} />
      </button>
    </div>
  );
}
