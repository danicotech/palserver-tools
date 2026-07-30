import { useState } from "react";
import { FiCheck, FiCopy, FiEye, FiEyeOff } from "react-icons/fi";
import { copyText } from "./clipboard";
import { t, useI18n } from "./i18n";

/**
 * 顯示一段可能很長的路徑:中間省略、尾端(最後一個路徑片段)保留,點擊複製完整內容。
 * CSS 原生的 text-ellipsis 只能砍尾端,這裡用 flex + truncate 讓「頭」自己省略、
 * 「尾」固定不動,做出「/very/long/…/server」的效果,避免長路徑把版面撐爆。
 */
export function CopyPath({
  value,
  className = "",
  secret,
}: {
  value: string;
  className?: string;
  /** 敏感路徑:預設模糊遮蔽(與配對碼同款),點眼睛才顯示;複製一律複製真值,遮蔽時 tooltip 也不顯示路徑。 */
  secret?: boolean;
}) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hidden = secret && !revealed;

  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // 以最後一個分隔符切成「頭 / 尾」;尾端含分隔符(如 "/server")固定顯示。
  const sep = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const hasTail = sep > 0 && sep < value.length - 1;
  const head = hasTail ? value.slice(0, sep) : value;
  const tail = hasTail ? value.slice(sep) : "";

  return (
    <button
      type="button"
      onClick={copy}
      title={hidden ? t("點擊複製") : `${value}\n(${t("點擊複製")})`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-left transition hover:text-pal ${className}`}
    >
      <span className={`flex min-w-0 flex-1 ${hidden ? "select-none blur-[6px]" : ""}`}>
        <span className="truncate">{head}</span>
        {tail && <span className="shrink-0">{tail}</span>}
      </span>
      {secret && (
        <span
          role="button"
          tabIndex={0}
          title={hidden ? t("顯示") : t("隱藏")}
          className="text-ink-muted transition hover:text-pal"
          onClick={(e) => {
            e.stopPropagation();
            setRevealed((v) => !v);
          }}
        >
          {hidden ? <FiEye className="size-4 shrink-0" /> : <FiEyeOff className="size-4 shrink-0" />}
        </span>
      )}
      {copied ? (
        <FiCheck className="size-4 shrink-0 text-grass" />
      ) : (
        <FiCopy className="size-4 shrink-0 text-ink-muted" />
      )}
    </button>
  );
}
