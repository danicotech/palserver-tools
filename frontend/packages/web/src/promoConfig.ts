/**
 * 站台設定(公開自架版)。
 *
 * 已移除所有製作者 / 團隊 / 公司 / 贊助 / 付費服務相關資訊,且不再向任何外部來源
 * 抓取設定(不 phone-home)。此處僅保留通用第三方工具的官網與教學搜尋連結
 * (Radmin VPN / Tailscale / playit.gg),供連線教學使用。
 *
 * 型別維持原本結構以相容各處消費端;身分相關欄位一律留空,對應 UI 不會顯示。
 */

export interface PromoConfig {
  company: { name: string; website: string; instagram: string; discord: string; sponsor: string; afdian?: string };
  ipService: { name: string; website: string; discord: string };
  /** 常見問題站(留空＝不顯示)。 */
  faq: string;
  /** 代管維護服務(公開版留空＝不顯示)。 */
  maintenanceService: { name: string; url: string; tagline: string; email: string };
  /** Discord 機器人服務(公開版留空＝不顯示)。 */
  botService: { name: string; url: string; tagline: string; email: string };
  vpn: {
    radmin: { site: string; tutorial: string };
    tailscale: { site: string; tutorial: string };
  };
  /** playit.gg 官網與教學連結。 */
  playit: { site: string; tutorial: string };
  /** 感謝名單(公開版留空＝不顯示)。 */
  credits: {
    developers: { name: string; role: string; url?: string }[];
    ambassadors?: { name: string; role: string; url?: string }[];
    donate: string;
    donateAfdian?: string;
  };
}

const CONFIG: PromoConfig = {
  company: { name: "", website: "", instagram: "", discord: "", sponsor: "", afdian: "" },
  ipService: { name: "", website: "", discord: "" },
  faq: "",
  maintenanceService: { name: "", url: "", tagline: "", email: "" },
  botService: { name: "", url: "", tagline: "", email: "" },
  vpn: {
    radmin: {
      site: "https://www.radmin-vpn.com/",
      tutorial: "https://www.youtube.com/results?search_query=Radmin+VPN+Palworld",
    },
    tailscale: {
      site: "https://tailscale.com/",
      tutorial: "https://www.youtube.com/results?search_query=Tailscale+Palworld",
    },
  },
  playit: {
    site: "https://playit.gg/",
    tutorial: "https://www.youtube.com/results?search_query=playit.gg+Palworld",
  },
  credits: { developers: [], ambassadors: [], donate: "", donateAfdian: "" },
};

/** 回傳站台設定。公開版為固定常數,不做任何外部抓取。 */
export function usePromoConfig(): PromoConfig {
  return CONFIG;
}
