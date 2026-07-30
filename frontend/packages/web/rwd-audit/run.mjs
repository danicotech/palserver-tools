// ── RWD 自我驗測流程 orchestrator ──────────────────────────────────────
// 啟動 vite preview(服務已編譯的 dist)→ 跑 audit.mjs → 收掉 preview。
// 用法(在 packages/web 已 build 之後):
//   node rwd-audit/run.mjs
// 或加上 --build 先重新編譯:
//   node rwd-audit/run.mjs --build
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..");               // packages/web
const VITE = resolve(WEB, "node_modules/vite/bin/vite.js");
const PORT = process.env.PORT || "4173";
const BASE = `http://localhost:${PORT}`;
const doBuild = process.argv.includes("--build");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (url) =>
  new Promise((res) => {
    const req = http.get(url, (r) => { r.resume(); res(r.statusCode > 0); });
    req.on("error", () => res(false));
    req.setTimeout(1500, () => { req.destroy(); res(false); });
  });
const run = (args, opts) => new Promise((res, rej) => {
  const c = spawn(process.execPath, args, { stdio: "inherit", ...opts });
  c.on("exit", (code) => (code === 0 ? res() : rej(new Error("exit " + code))));
  c.on("error", rej);
});

let preview;
const cleanup = () => { try { preview?.kill(); } catch { /* noop */ } };
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
  if (doBuild) {
    console.log("› building…");
    await run([VITE, "build"], { cwd: WEB }).catch(async () => {
      // 若有型別檢查腳本,build 失敗直接中止
      throw new Error("build failed");
    });
  }
  console.log(`› starting preview on :${PORT}…`);
  preview = spawn(process.execPath, [VITE, "preview", "--port", PORT], { cwd: WEB, stdio: "ignore" });
  preview.on("error", (e) => { console.error("preview error", e); process.exit(2); });

  let up = false;
  for (let i = 0; i < 40 && !up; i++) { up = await ping(BASE); if (!up) await wait(300); }
  if (!up) { console.error("preview did not come up on " + BASE); cleanup(); process.exit(2); }

  console.log("› running RWD audit…");
  let auditCode = 0;
  await run([resolve(HERE, "audit.mjs")], { cwd: HERE, env: { ...process.env, BASE } }).catch((e) => {
    auditCode = /exit 1/.test(String(e)) ? 1 : 2;
  });
  cleanup();
  process.exit(auditCode);
} catch (e) {
  console.error(String(e));
  cleanup();
  process.exit(2);
}
