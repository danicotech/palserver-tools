// ── RWD 自我驗測 (self-audit) ──────────────────────────────────────────
// 對面板(玩家查詢)在多種真實裝置寬度巡檢每個分頁,程式化檢查 RWD 問題並全頁截圖。
// 由 run.mjs 啟動 vite preview 後呼叫;也可自行設定 BASE 直接跑。
//   BASE=http://localhost:4173 node audit.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:4173";
const FILTER = process.env.PROFILE || "";
const SHOTS = resolve(HERE, "shots");

// 真實裝置視窗(含 320 窄手機邊界)
const PROFILES = [
  { name: "galaxy-fold", w: 320, h: 750 },
  { name: "iphone-se", w: 375, h: 667 },
  { name: "iphone-12", w: 390, h: 844 },
  { name: "pixel-7", w: 412, h: 915 },
  { name: "ipad-mini", w: 768, h: 1024 },
  { name: "ipad-pro", w: 1024, h: 1366 },
  { name: "desktop", w: 1280, h: 800 },
].filter((p) => !FILTER || p.name.includes(FILTER));

const PANEL_TABS = ["總覽", "玩家查詢", "帕魯查詢", "詞條查詢", "圖鑑收服率", "首領進度", "排行榜", "上線分析"];

// ── in-page 檢查 ──
const audit = () => {
  const vw = document.documentElement.clientWidth;
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p) {
      const c = getComputedStyle(p);
      if (c.overflowX === "auto" || c.overflowX === "scroll") return true;
      p = p.parentElement;
    }
    return false;
  };
  const vis = (el, r, c) => r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none";
  const lbl = (el) => ({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || "").slice(0, 70), text: (el.textContent || "").trim().slice(0, 30) });
  const pageOverflow = [], wideEls = [], clipped = [], tinyText = [], smallTap = [];

  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    if (!vis(el, r, c)) continue;
    if (r.right > vw + 1 && !inScroller(el) && c.overflowX !== "auto" && c.overflowX !== "scroll")
      pageOverflow.push({ ...lbl(el), right: Math.round(r.right), vw });
    if (r.width > vw + 1 && !inScroller(el)) wideEls.push({ ...lbl(el), w: Math.round(r.width), vw });
    // 真正被裁掉且看不到的內容(排除刻意的 truncate 省略號)
    if (el.scrollWidth > el.clientWidth + 2 && (c.overflowX === "hidden" || c.overflowX === "clip") && c.textOverflow !== "ellipsis" && r.width > 60)
      clipped.push({ ...lbl(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
    const fs = parseFloat(c.fontSize);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && fs && fs < 11) tinyText.push({ ...lbl(el), fs: Math.round(fs * 10) / 10 });
  }
  for (const el of document.querySelectorAll("button, a[href], select, [role=button]")) {
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    if (!vis(el, r, c)) continue;
    if (r.height < 40 || r.width < 24) smallTap.push({ ...lbl(el), h: Math.round(r.height), w: Math.round(r.width) });
  }
  const dedup = (a, k) => { const m = new Map(); for (const x of a) { const key = k(x); if (!m.has(key)) m.set(key, x); } return [...m.values()]; };
  return {
    scrollW: document.documentElement.scrollWidth, clientW: vw,
    pageOverflow: dedup(pageOverflow, (x) => x.tag + x.cls).slice(0, 10),
    wideEls: dedup(wideEls, (x) => x.tag + x.cls).slice(0, 10),
    clipped: dedup(clipped, (x) => x.tag + x.cls).slice(0, 10),
    tinyText: dedup(tinyText, (x) => x.cls + x.text).slice(0, 10),
    smallTap: dedup(smallTap, (x) => x.cls + x.text).slice(0, 12),
  };
};

const gotoTab = async (page, label, w) => {
  try {
    if (w < 1024) {
      await page.locator("button[aria-label='開啟分頁選單']").click({ timeout: 4000 });
      await page.waitForTimeout(250);
      await page.locator("[role='dialog'] nav button", { hasText: label }).first().click({ timeout: 4000 });
    } else {
      await page.locator("nav.lg\\:flex button", { hasText: label }).first().click({ timeout: 4000 });
    }
  } catch { /* stay */ }
  await page.waitForTimeout(600);
};

const run = async () => {
  const browser = await chromium.launch();
  mkdirSync(SHOTS, { recursive: true });
  const report = { base: BASE, generatedProfiles: PROFILES.map((p) => p.name), profiles: {} };
  let fails = 0;

  for (const vp of PROFILES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header h1", { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => !document.body.textContent.includes("載入存檔資料中"), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);
    report.profiles[vp.name] = { size: `${vp.w}x${vp.h}`, tabs: {} };
    for (const tab of PANEL_TABS) {
      if (tab !== "總覽") await gotoTab(page, tab, vp.w);
      const res = await page.evaluate(audit);
      const problems = (res.scrollW > res.clientW + 1 ? 1 : 0) + res.pageOverflow.length + res.wideEls.length + res.clipped.length + res.tinyText.length;
      if (problems) fails++;
      report.profiles[vp.name].tabs[tab] = res;
      await page.screenshot({ path: `${SHOTS}/${vp.name}-${tab}.png`, fullPage: true }).catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(resolve(HERE, "audit-report.json"), JSON.stringify(report, null, 2));

  console.log(`\n═══ RWD AUDIT (${PROFILES.length} devices × ${PANEL_TABS.length} tabs) ═══`);
  for (const [prof, pd] of Object.entries(report.profiles)) {
    for (const [tab, r] of Object.entries(pd.tabs)) {
      const issues = [];
      if (r.scrollW > r.clientW + 1) issues.push(`PAGE-SCROLL ${r.scrollW}/${r.clientW}`);
      if (r.pageOverflow.length) issues.push(`overflow×${r.pageOverflow.length}`);
      if (r.wideEls.length) issues.push(`wide×${r.wideEls.length}`);
      if (r.clipped.length) issues.push(`clipped×${r.clipped.length}`);
      if (r.tinyText.length) issues.push(`tiny-text×${r.tinyText.length}`);
      if (issues.length) console.log(`  ✗ ${prof.padEnd(12)} ${tab.padEnd(6)} → ${issues.join(", ")}`);
    }
  }
  console.log(`\n${fails === 0 ? "✅ PASS — no RWD issues" : "✗ " + fails + " tab/size combos with issues"} · detail: audit-report.json · shots: rwd-audit/shots/`);
  process.exit(fails === 0 ? 0 : 1);
};
run().catch((e) => { console.error("FATAL", e); process.exit(2); });
