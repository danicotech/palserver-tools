// 右上角「玩家頭像」：從現有玩家下拉選一位 + 選一隻帕魯當頭像；
// 共用名冊、所有人可見，且會連動到各處榜單顯示。
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { getRoster, setRoster, type RosterEntry } from "./api";
import { loadPaldex, getPalRoster, palInfo, localizedName, type PalRosterEntry } from "./paldex";
import { useRoster } from "./rosterCtx";
import { t } from "../i18n";

const LS_ME = "palpanel.me";

interface Me {
  name: string;
  palId: string;
}

interface PlayerRef {
  name: string;
  uid: string;
}

function loadMe(): Me | null {
  try {
    const raw = localStorage.getItem(LS_ME);
    if (!raw) return null;
    const m = JSON.parse(raw) as Me;
    return m.name && m.palId ? m : null;
  } catch {
    return null;
  }
}

/** 圓形頭像小圖；沒有圖或載入失敗時顯示 🐾 佔位（不會出現破圖）。 */
function Avatar({ palId, size = 28 }: { palId: string; size?: number }): JSX.Element {
  const url = palInfo(palId).iconUrl;
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-card-soft leading-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>🐾</span>
      )}
    </span>
  );
}

export function HeaderAvatar({ players }: { players: PlayerRef[] }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(loadMe);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadPaldex().then(() => setReady(true));
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("設定頭像")}
        className="flex items-center gap-2 rounded-full border-2 border-line bg-card-soft px-2 py-1 text-sm text-ink transition hover:-translate-y-px hover:border-pal"
      >
        {me && ready ? (
          <>
            <Avatar palId={me.palId} />
            <span className="max-w-[8rem] truncate font-medium">{me.name}</span>
          </>
        ) : (
          <span className="px-1">🐾 {t("設定頭像")}</span>
        )}
      </button>
      {open && ready && (
        <AvatarModal
          me={me}
          players={players}
          onClose={() => setOpen(false)}
          onSaved={(m) => {
            setMe(m);
            localStorage.setItem(LS_ME, JSON.stringify(m));
          }}
        />
      )}
    </>
  );
}

function AvatarModal({
  me,
  players,
  onClose,
  onSaved,
}: {
  me: Me | null;
  players: PlayerRef[];
  onClose: () => void;
  onSaved: (m: Me) => void;
}): JSX.Element {
  const { refresh } = useRoster();
  const all: PalRosterEntry[] = getPalRoster();
  // 玩家名下拉：去重 + 依名稱排序（只能選現有玩家，不可自創）
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.name.trim()) set.add(p.name.trim());
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [players]);

  const [name, setName] = useState(me && names.includes(me.name) ? me.name : "");
  const [palId, setPalId] = useState(me?.palId ?? "");
  const [search, setSearch] = useState("");
  const [roster, setRosterState] = useState<RosterEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    getRoster().then(setRosterState);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => localizedName(p.names).toLowerCase().includes(q) || (p.names.en ?? "").toLowerCase().includes(q) || p.key.includes(q));
  }, [all, search]);

  const canSave = name.length > 0 && palId.length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr("");
    const ok = await setRoster(name, palId);
    setSaving(false);
    if (!ok) {
      setErr(t("儲存失敗：後端未連線或無法寫入"));
      return;
    }
    onSaved({ name, palId });
    refresh(); // 讓各處榜單即時連動更新
    getRoster().then(setRosterState);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="mt-8 w-full max-w-2xl rounded-cute bg-card p-5 shadow-cute ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">🐾 {t("設定玩家頭像")}</h2>
          <button onClick={onClose} className="rounded-full px-2 py-1 text-ink-muted hover:text-ink" title={t("關閉")}>
            ✕
          </button>
        </div>

        {names.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">{t("玩家資料載入中，請稍候…")}</p>
        ) : (
        <>
        {/* 玩家下拉（只能選現有玩家）+ 目前選擇預覽 */}
        <div className="mb-3 flex items-center gap-3">
          {palId && <Avatar palId={palId} size={44} />}
          <select
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-full border-2 border-line bg-card-soft px-4 py-2 text-ink outline-none focus:border-pal"
          >
            <option value="">{names.length ? t("選擇玩家…") : t("載入玩家中…")}</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={!canSave}
            className="rounded-full bg-pal px-4 py-2 font-medium text-white transition enabled:hover:-translate-y-px disabled:opacity-40"
          >
            {saving ? t("儲存中…") : t("儲存")}
          </button>
        </div>
        {err && <p className="mb-2 text-sm text-berry">{err}</p>}

        {/* 帕魯選擇器 */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("搜尋帕魯（中文名）")}
          className="mb-2 w-full rounded-full border border-line bg-card-soft px-3 py-1.5 text-base text-ink outline-none focus:border-pal sm:text-sm"
        />
        <div className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto rounded-cute bg-card-soft p-2 ring-1 ring-line sm:grid-cols-6">
          {filtered.map((p) => (
            <button
              key={p.key}
              onClick={() => setPalId(p.key)}
              title={localizedName(p.names)}
              className={`flex flex-col items-center gap-1 rounded-lg p-1.5 transition hover:bg-card ${
                palId === p.key ? "ring-2 ring-pal" : ""
              }`}
            >
              <img
                src={p.iconUrl}
                alt={localizedName(p.names)}
                loading="lazy"
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
              />
              <span className="w-full truncate text-center text-[11px] text-ink-muted">{localizedName(p.names)}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="col-span-full py-6 text-center text-sm text-ink-muted">{t("查無帕魯")}</p>}
        </div>
        </>
        )}

        {/* 共用名冊 */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-muted">
            {t("已設定頭像的玩家")} {roster ? `（${roster.length}）` : ""}
          </h3>
          {roster === null ? (
            <p className="text-sm text-ink-muted">{t("載入中…")}</p>
          ) : roster.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("還沒有人設定頭像，當第一個吧！")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {roster.map((r) => (
                <span
                  key={r.name + r.updatedAt}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card-soft py-1 pl-1 pr-3 text-sm text-ink"
                >
                  <Avatar palId={r.palId} size={24} />
                  <span className="max-w-[10rem] truncate">{r.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
