**繁體中文** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# 🐏 帕魯玩家查詢工具網(Palworld 伺服器全家桶)

**雙擊一個檔案就能開好整套 Palworld 伺服器**,並附一個玩家用瀏覽器就能看的查詢網站:

![總覽](docs/screenshots/01-dashboard.png)

- 🖥️ Palworld 專用伺服器(Docker 社群映像)
- ⏰ 自動排程開關服(時段開關、關服倒數廣播、崩潰自動重啟)
- 🌐 玩家查詢網站:總覽 / 玩家 / 帕魯 / 詞條 / **配種表** / 圖鑑 / 首領 / 排行榜 / 上線分析
- 🥚 配種表:299 隻 × 44,851 筆配方全覆蓋,互動**配種樹**與**最短路徑**規劃、玩家視角標記已擁有/缺
- 🌍 網站四語介面(繁中/簡中/英/日)

📖 **[完整使用手冊(全功能圖文教學)](docs/manual.html)** · 截圖目錄:[docs/screenshots/](docs/screenshots/)

---

## 🚀 三步驟開服(不用會任何指令)

1. **安裝 Docker**
   - Windows:安裝並打開 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   - Linux:`curl -fsSL https://get.docker.com | sh`
2. **下載本專案**:點 GitHub 綠色 `Code` 按鈕 → `Download ZIP` → 解壓縮(或 `git clone`)
3. **啟動**
   - Windows:雙擊 **`start.bat`**
   - Linux/macOS:`./start.sh`

第一次啟動會**自動產生所有設定與兩組隨機密碼**(顯示在視窗裡,請抄下來),然後自動下載映像並開好四個服務。完成後:

| 服務 | 位址 |
|---|---|
| 玩家查詢網站 | `http://localhost`(或 `http://主機IP`) |
| 遊戲連線 | `主機IP:8211`(UDP)+ 視窗顯示的進服密碼 |

## 🕹️ 日常操作(雙擊即可)

| 動作 | Windows | Linux/macOS |
|---|---|---|
| 啟動全部 | `start.bat` | `./start.sh` |
| 重啟(套用新設定) | `restart.bat` | `./restart.sh` |
| 停止全部 | `stop.bat` | `./stop.sh` |
| 看狀態/日誌 | `status.bat` | `./status.sh` |

偏好單一執行檔?裝好 [Go](https://go.dev/dl/) 後 `cd tools/launcher && go build -o ../../palserver.exe .`,雙擊 `palserver.exe` 會有數字選單(啟動/重啟/停止/狀態/只更新網站)。

## 🎛️ 調整伺服器參數:只改一個檔 `.env`

**所有** Palworld 參數(名稱、人數、密碼、經驗/捕捉/傷害倍率、孵蛋時間、PvP…約 50 項)都集中在專案根目錄的 `.env`,每一項在 [`.example.env`](.example.env) 都有英文註解說明。改完存檔 → 雙擊 `restart.bat` 即套用:

```env
SERVER_NAME=My Palworld Server
PLAYERS=32
EXP_RATE=1.0          # 經驗倍率
PAL_CAPTURE_RATE=1.0  # 捕捉率
PAL_EGG_DEFAULT_HATCHING_TIME=72.0  # 孵蛋小時數
```

> `.env` 不會進 git,你的密碼只存在自己電腦。沒寫的項目自動用預設值。

## 🚚 無痛搬家:把你原本伺服器的存檔換進來

系統只讀一個位置:`backend/palworld-data/`。把原伺服器的世界資料夾整個複製進來,網站的所有資料就變成你的伺服器:

```text
backend/palworld-data/Pal/Saved/SaveGames/0/<你的世界GUID>/   ← 整個資料夾放這裡
    ├── Level.sav        (世界主存檔)
    ├── LevelMeta.sav
    └── Players/*.sav    (每位玩家)
```

1. 兩邊伺服器都先停止(`stop.bat`)
2. 原存檔位置:Windows 專服 `PalServer\Pal\Saved\SaveGames\0\<GUID>`;Linux/Docker 同層級
3. 複製整個 `<GUID>` 資料夾到上面路徑
4. Linux 主機:`sudo chown -R 1000:1000 backend/palworld-data`
5. `start.bat` → 網站右上 🔄 重新載入

> ⚠️ 不要直接改 `PalWorldSettings.ini` —— 每次開機會由 `.env` 重新產生。

## ⏰ 排程與廣播:`backend/config.json`

開服時段表與關服倒數廣播都在這(首次啟動自動產生;`config.example.json` 為範本):

| 欄位 | 說明 |
|---|---|
| `schedule.windows` | 開服時段。例 `{ "days": ["Sat","Sun"], "open": "10:00", "close": "03:00" }`(跨午夜自動處理;24 小時開 = `00:00`~`24:00` 全週) |
| `hooks.onClose.announce` | 關服前廣播:`{ "at": 600, "message": "10 分鐘後關服" }`,想改時間/文案只改這個陣列 |
| `api.token` | 網站後台呼叫排程器的密碼(自動隨機產生) |

改完:`docker compose restart scheduler`(或直接 `restart.bat`)。

## 🔄 遊戲改版後更新配種資料(選配)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # 配方
node scripts/fetch-pal-meta.mjs           # 屬性/圖鑑編號/稀有度
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## ❓ 常見問題

| 問題 | 解法 |
|---|---|
| 網站沒有玩家資料 | 存檔沒放對位置(見搬家章節),或伺服器還沒開過;放好後按網站 🔄 |
| 排程沒開服 | 檢查 `.env` 的 `TZ` 與 `config.json` 的 `schedule.windows`;`status.bat` 看日誌 |
| 忘記密碼 | 打開根目錄 `.env` 就看得到;改完 `restart.bat` |
| 埠被占用 | 80/8211/9000 改 compose 的 ports 左半邊 |

## 授權與致謝

- 配種配方:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT)
- 屬性/稀有度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- 伺服器映像:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- 其餘資料來源見 `frontend/packages/web/public/game-data/CREDITS.md`
