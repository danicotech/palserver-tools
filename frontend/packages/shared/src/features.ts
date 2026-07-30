/**
 * 功能授權判斷(agent 與 web 共用)。
 *
 * 本版本為公開自架版:所有功能一律免費開放,沒有任何專屬 / 付費閘門。
 * 目錄留空即代表「全部功能免費」;型別與函式保留以維持相容性。
 */

export interface EarlyAccessFeature {
  id: string;
  label: string;
}

/** 空目錄＝所有功能對所有人免費開放。 */
export const EARLY_ACCESS_FEATURES: EarlyAccessFeature[] = [];

/** 這個功能是否對所有人免費 —— 本版本一律 true。 */
export function featureFreeNow(_id: string): boolean {
  return true;
}

/** agent 回報給前端的授權狀態。 */
export interface LicenseStatus {
  /** 使用者是否已填識別碼。 */
  hasKey: boolean;
  /** 識別碼目前是否有效(含離線寬限期內)。 */
  valid: boolean;
  tier: string | null;
  /** 這張識別碼解鎖的早鳥功能 id。 */
  features: string[];
  /** 到期日(ISO)或 null=永久。 */
  expiresAt: string | null;
  /** 無效原因:invalid / bound-to-another / expired / offline / server-error。 */
  reason: string | null;
  /** 這台伺服器的機器碼(短)—— 識別碼一旦啟用就綁這台。 */
  machineId: string;
  /** 上次向伺服器驗證的時間(ISO);離線時前端可提示。 */
  checkedAt: string | null;
}

/**
 * 統一的功能可用性判斷:免費功能 OR 有有效贊助授權。
 *
 * 目前只有單一贊助層級,識別碼的 `features` 清單僅供顯示 —— 有效贊助者一律解鎖
 * 全部贊助者功能(這樣新增功能不必重發碼 / 改 worker)。若日後要做分層,再把
 * `lic.features.includes(id)` 的判斷加回來即可。
 */
export function hasFeature(id: string, lic: Pick<LicenseStatus, "valid" | "features">): boolean {
  return featureFreeNow(id) || lic.valid;
}
