/**
 * Engine.ini performance options for the dedicated server.
 *
 * Only options that actually do something on a headless server are exposed.
 * The optimization guides floating around also set rendering keys
 * (r.Streaming.PoolSize, r.Shadow.MaxResolution, GameDefaultMap, Core.System
 * Paths…) — a dedicated server renders nothing, so those are noise. Anything
 * not listed here can still be edited through "編輯原始檔".
 *
 * `default` is the engine's behaviour when the key is absent, so the UI can
 * show what you get by doing nothing.
 */

export type EngineOptionCategory = "network" | "framerate" | "memory";

export interface EngineOptionMeta {
  section: string;
  type: "int" | "float" | "bool";
  /** value when the key is absent from Engine.ini */
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  category: EngineOptionCategory;
  label: string;
  hint?: string;
  /** shown as a caution next to the field */
  warn?: string;
  /** bytes/s 欄位:在輸入框旁併列顯示換算後的 Mbps,方便對照家用網路方案。 */
  showMbps?: boolean;
}

const NET_DRIVER = "/Script/OnlineSubsystemUtils.IpNetDriver";
const ENGINE = "/Script/Engine.Engine";
const GC = "/Script/Engine.GarbageCollectionSettings";

export const ENGINE_OPTIONS = {
  NetServerMaxTickRate: {
    section: NET_DRIVER,
    type: "int",
    default: 30,
    min: 20,
    max: 120,
    category: "network",
    label: "伺服器 Tick 率",
    hint: "伺服器每秒送給玩家的更新次數。提高會更跟手,但吃 CPU;人數越多、據點與帕魯越多,能撐住的 Tick 率越低。",
    warn: "不建議超過 120;撐不住時反而更卡。低於 50 會明顯影響手感。",
  },
  MaxClientRate: {
    section: NET_DRIVER,
    type: "int",
    default: 15000,
    min: 10000,
    max: 125000000,
    step: 10000,
    category: "network",
    label: "每位玩家頻寬上限(bytes/s)",
    hint: "提高可減少高 Tick 率下的封包裁切、加快玩家載入與切換地圖,代價是上行頻寬。",
    warn: "總上行需求 ≈ 每人上限 × 在線人數;設定超過網路上行能力,反而會讓所有人一起卡。",
    showMbps: true,
  },
  MaxInternetClientRate: {
    section: NET_DRIVER,
    type: "int",
    default: 10000,
    min: 10000,
    max: 125000000,
    step: 10000,
    category: "network",
    label: "網際網路玩家頻寬上限(bytes/s)",
    hint: "同上,套用在非區網玩家。通常與上一項設為相同值。",
    showMbps: true,
  },
  ConnectionTimeout: {
    section: NET_DRIVER,
    type: "float",
    default: 60,
    min: 10,
    max: 300,
    step: 5,
    category: "network",
    label: "連線逾時(秒)",
    hint: "伺服器卡頓時,調高可避免玩家被誤踢。",
  },
  InitialConnectTimeout: {
    section: NET_DRIVER,
    type: "float",
    default: 60,
    min: 10,
    max: 300,
    step: 5,
    category: "network",
    label: "初次連線逾時(秒)",
    hint: "世界很大、載入很久時,調高可避免玩家在進場途中斷線。",
  },

  bUseFixedFrameRate: {
    section: ENGINE,
    type: "bool",
    default: false,
    category: "framerate",
    label: "固定畫格率",
    hint: "讓伺服器以固定步進運行,模擬較穩定。",
    warn: "與 Tick 率互相影響。硬體不夠力時開啟反而會拖慢模擬,建議搭配觀察伺服器 FPS。",
  },
  FixedFrameRate: {
    section: ENGINE,
    type: "float",
    default: 30,
    min: 20,
    max: 120,
    step: 1,
    category: "framerate",
    label: "固定畫格率數值",
    hint: "僅在「固定畫格率」開啟時生效,通常設為與 Tick 率相同。",
  },
  bSmoothFrameRate: {
    section: ENGINE,
    type: "bool",
    default: false,
    category: "framerate",
    label: "平滑畫格率",
    hint: "讓畫格時間變化較平緩,減少突發的頓挫。",
  },

  "gc.TimeBetweenPurgingPendingKillObjects": {
    section: GC,
    type: "int",
    default: 60,
    min: 10,
    max: 600,
    category: "memory",
    label: "垃圾回收間隔(秒)",
    hint: "回收待刪物件的間隔。調短可壓低記憶體佔用,但每次回收可能造成短暫頓挫;調長則相反。",
  },
} as const satisfies Record<string, EngineOptionMeta>;

export type EngineOptionKey = keyof typeof ENGINE_OPTIONS;

export const ENGINE_CATEGORY_LABELS: Record<EngineOptionCategory, string> = {
  network: "網路",
  framerate: "畫格率",
  memory: "記憶體",
};

export type EngineSettings = Partial<Record<EngineOptionKey, number | boolean>>;

/**
 * Presets. "balanced" is the widely-shared community tuning; "performance"
 * pushes the tick rate for strong CPUs and few players; "default" clears our
 * managed keys back to engine behaviour.
 */
export const ENGINE_PRESETS: Record<
  "default" | "balanced" | "performance",
  { label: string; description: string; values: EngineSettings }
> = {
  default: {
    label: "遊戲預設",
    description: "移除本面板管理的設定,回到引擎預設行為。",
    values: {
      NetServerMaxTickRate: 30,
      MaxClientRate: 15000,
      MaxInternetClientRate: 10000,
      ConnectionTimeout: 60,
      InitialConnectTimeout: 60,
      bUseFixedFrameRate: false,
      FixedFrameRate: 30,
      bSmoothFrameRate: false,
      "gc.TimeBetweenPurgingPendingKillObjects": 60,
    },
  },
  balanced: {
    label: "平衡(建議)",
    description: "社群常用的調校:Tick 率 60、放寬頻寬與逾時。多數伺服器適用。",
    values: {
      NetServerMaxTickRate: 60,
      MaxClientRate: 100000,
      MaxInternetClientRate: 100000,
      ConnectionTimeout: 60,
      InitialConnectTimeout: 60,
      bUseFixedFrameRate: false,
      FixedFrameRate: 60,
      bSmoothFrameRate: true,
      "gc.TimeBetweenPurgingPendingKillObjects": 60,
    },
  },
  performance: {
    label: "高效能",
    description: "Tick 率 90,適合 CPU 單核效能強、人數少的伺服器。務必觀察伺服器 FPS。",
    values: {
      NetServerMaxTickRate: 90,
      MaxClientRate: 150000,
      MaxInternetClientRate: 150000,
      ConnectionTimeout: 60,
      InitialConnectTimeout: 60,
      bUseFixedFrameRate: true,
      FixedFrameRate: 90,
      bSmoothFrameRate: true,
      "gc.TimeBetweenPurgingPendingKillObjects": 30,
    },
  },
};

export interface EngineSettingsStatus {
  supported: boolean;
  reason?: string;
  /** false when Engine.ini doesn't exist yet (server never started) */
  exists: boolean;
  /** server-dir-relative path, for the raw editor */
  path: string | null;
  /** only keys actually present in the file; absent keys use engine defaults */
  values: EngineSettings;
}
