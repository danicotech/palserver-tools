# 🆘 FAQ

| 問題 | 解法 |
|---|---|
| 網站打開沒有玩家資料 | 存檔沒放對位置(見 [[存檔搬家]]),或伺服器從未開過;放好後按網站右上 🔄 |
| 排程沒有開服 | 檢查 `.env` 的 `TZ` 與 `config.json` 的 `schedule.windows`(見 [[排程與廣播 config.json]]);`windows\status.bat` 看日誌 |
| 廣播沒出現 | `ADMIN_PASSWORD`(.env)與 `rcon.password`(config.json)不一致 |
| 忘記密碼 | 根目錄 `.env` 內明文可見;改完 `windows\restart.bat` |
| 埠被占用 | 80(網站)/8211(遊戲)/9000(API)改 compose ports 左半邊 |
| 想手動立刻開/關服 | `POST /api/open` / `/api/close` / `/api/resume`(帶 `api.token`) |
| 遊戲改版後帕魯缺資料 | 跑 `frontend/scripts/fetch-palcalc-breeding.mjs` 與 `fetch-pal-meta.mjs` 後重建 panel |
| 想把網站公開到外網 | 自行架反向代理/隧道指向本機 80 埠 |
| 沒有 Docker | 見 [[SteamCMD 版]] |
| `dockerDesktopLinuxEngine ... cannot find the file specified` | Docker 裝好了但**引擎沒在跑**。`start.bat` 會自動開 Docker Desktop 並等最多 3 分鐘;仍失敗就手動打開它、等鯨魚圖示不再轉動再重跑。首次安裝可能要啟用 WSL 2 並重開機 |
| `Cannot connect to the Docker daemon`(Linux) | `sudo systemctl start docker`;權限問題 `sudo usermod -aG docker "$USER"` 後重新登入 |
