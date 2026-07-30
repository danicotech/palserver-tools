/**
 * 複製文字到剪貼簿,回傳是否成功。
 *
 * 為什麼要自己包:`navigator.clipboard` 只有在「安全情境」(HTTPS 或 localhost)
 * 才存在。本工具常透過 http://區網或 VPN IP(例如 http://100.x:8250)開啟,那是
 * 非安全情境,`navigator.clipboard` 會是 undefined —— 直接呼叫會丟錯,複製失敗
 * 且連成功打勾都不會出現。所以先試現代 API,失敗再退回舊的 execCommand 做法。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 掉到下面的 fallback */
  }
  // Fallback:離螢幕的 textarea + execCommand("copy"),非安全情境也能用。
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
