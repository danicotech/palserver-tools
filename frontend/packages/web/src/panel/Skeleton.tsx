// 首次載入的骨架屏 —— 用與實際內容相同的版面骨架佔位,
// 讓資料進來時是「填上去」而不是整頁抽換,避免版面跳動。
import type { JSX } from "react";

function Bar({ className = "" }: { className?: string }): JSX.Element {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/** 一張玩家卡的骨架(頭像 + 標題 + 幾個 chip)。 */
function CardSkeleton(): JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
      <div className="border-b border-line bg-gradient-to-r from-pal/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <div className="skeleton size-9 shrink-0 rounded-full" />
          <Bar className="h-6 w-40" />
          <Bar className="ml-auto h-4 w-56 hidden sm:block" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[16, 24, 20, 20, 24].map((w, i) => (
            <Bar key={i} className={`h-6 w-${w}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 分頁內容的骨架:統計列 + 地圖區 + 幾張卡。 */
export function ContentSkeleton(): JSX.Element {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-cute bg-card p-4 ring-1 ring-line">
            <Bar className="h-4 w-20" />
            <Bar className="mt-3 h-8 w-24" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-cute bg-card ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Bar className="h-5 w-28" />
          <Bar className="h-7 w-40" />
          <Bar className="ml-auto h-7 w-32" />
        </div>
        <div className="skeleton h-80 w-full" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
