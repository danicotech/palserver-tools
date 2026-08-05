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

## 🚀 兩種版本,挑一個

兩種都是**完整服務**(遊戲伺服器 + 自動排程開關服 + 存檔解析 + 玩家查詢網站),
差別只在「誰來跑這些服務」:

| | 🐳 **Docker 版**(推薦) | 🧱 **SteamCMD 版** |
|---|---|---|
| 遊戲伺服器 | ✅ | ✅ |
| 自動排程開關服 / 關服廣播 | ✅ | ✅ |
| 玩家查詢網站 | ✅ `http://localhost` | ✅ `http://localhost:9000` |
| 要先裝什麼 | **只要 Docker Desktop** | 首次由 install 自動裝 Python / Node / Go |
| 怎麼開關伺服器 | Docker Engine API | 直接管本機行程 |
| 伺服器設定改哪 | 專案根目錄 `.env`(約 50 項,一個檔搞定) | `PalWorldSettings.ini` |
| 存檔放哪 | `backend/palworld-data/` | `windows\native\server\` |
| 適合誰 | 大多數人;更新、搬機器都最省事 | 裝不了 Docker、或就是不想裝的人 |

**存檔格式完全相同**,兩邊隨時可以互搬(見 [docs/SteamCMD版.md](docs/SteamCMD版.md))。

### 🐳 Docker 版:三步驟

1. **安裝 Docker**([什麼是 Docker?](#-關於-docker))
   - Windows / macOS:裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/),裝完**要把它打開**(工作列出現鯨魚圖示才算啟動)
   - Linux:`curl -fsSL https://get.docker.com | sh`
2. **下載本專案**:GitHub 綠色 `Code` → `Download ZIP` → 解壓縮(或 `git clone`)
3. **啟動**:雙擊 **`windows\start.bat`**(Linux/macOS:`bash linux/start.sh`)

第一次啟動會**自動產生所有設定**,並使用預設密碼(會顯示在視窗裡):
**管理密碼 `654321`、進服密碼 `123456`** —— 要開放給外網玩請先改掉(編輯 `.env`),
然後自動下載映像並開好四個服務:

| 服務 | 位址 |
|---|---|
| 玩家查詢網站 | `http://localhost`(或 `http://主機IP`) |
| 遊戲連線 | `主機IP:8211`(UDP)+ 視窗顯示的進服密碼 |

### 🧱 SteamCMD 版:兩步驟

1. 雙擊 **`windows\native\install.bat`** —— 它會**自己**把要用的東西一次裝好:
   SteamCMD → 遊戲伺服器 → Python → Node → Go → 建置查詢網站 → 編譯排程器 → 產生設定檔
   (缺的工具自動下載官方可攜版到專案資料夾,不動系統、免 winget,乾淨電腦一鍵到底)
2. 雙擊 **`windows\native\start-all.bat`** —— 一次帶起四項服務

| 服務 | 位址 |
|---|---|
| 玩家查詢網站 | `http://localhost:9000` |
| 遊戲連線 | `主機IP:8211`(UDP) |

Linux 對應:`bash linux/native/install.sh` → `bash linux/native/start-all.sh`。

> **選不下去?** 直接雙擊 `windows\start.bat` —— 偵測不到 Docker 時,
> 它會問你要不要改用 SteamCMD 版,按 Y 就會自動走那條路。

## 🐳 關於 Docker

**Docker 版**把伺服器、排程器、存檔解析、查詢網站四個服務各自跑在一個容器裡。
你**不需要**懂 Docker —— 只要裝好、打開,剩下交給 `start.bat` / `start.sh`。
(SteamCMD 版一樣有這四項服務,只是直接跑在本機,不用容器。)

| 連結 | 用途 |
|---|---|
| [Docker 官網](https://www.docker.com/) | 專案首頁與說明 |
| [**Docker Desktop 下載**](https://www.docker.com/products/docker-desktop/) | **Windows / macOS 用這個**,含圖形介面,裝完打開即可 |
| [Docker Engine 安裝文件](https://docs.docker.com/engine/install/) | Linux 伺服器用;或直接 `curl -fsSL https://get.docker.com \| sh` |
| [Docker 官方入門教學](https://docs.docker.com/get-started/) | 想了解它在做什麼再看,不看也不影響使用 |

裝好後開一個終端機確認(兩個指令都要有版本號才算成功):

```bash
docker --version
docker compose version
```

> **Windows 常見狀況**:`start.bat` 說「找不到 Docker」= Docker Desktop 沒開或還在啟動中,
> 等工作列鯨魚圖示不再轉動再重跑一次。首次安裝可能會要求開啟 WSL 2 並重開機。
> 不想裝 Docker 的話,改用 [SteamCMD 版](docs/SteamCMD版.md) 一樣有完整服務(含查詢網站),只是要多裝 Python / Node / Go。

## 🕹️ 日常操作(雙擊即可)

**🐳 Docker 版**

| 動作 | Windows | Linux/macOS |
|---|---|---|
| 啟動全部 | `windows\start.bat` | `bash linux/start.sh` |
| 重啟(套用新設定) | `windows\restart.bat` | `bash linux/restart.sh` |
| 停止全部 | `windows\stop.bat` | `bash linux/stop.sh` |
| 看狀態/日誌 | `windows\status.bat` | `bash linux/status.sh` |

**🧱 SteamCMD 版**

| 動作 | Windows | Linux/macOS |
|---|---|---|
| 一次裝好全部 | `windows\native\install.bat` | `bash linux/native/install.sh` |
| 啟動全部服務 | `windows\native\start-all.bat` | `bash linux/native/start-all.sh` |
| 停止全部服務 | `windows\native\stop-all.bat` | `bash linux/native/stop-all.sh` |
| 只開/關遊戲伺服器 | `windows\native\start.bat` / `stop.bat` | `linux/native/start.sh` / `stop.sh` |
| 更新遊戲版本 | `windows\native\update.bat` | `bash linux/native/update.sh` |

偏好單一執行檔?裝好 [Go](https://go.dev/dl/) 後 `cd tools/launcher && go build -o ../../palserver.exe .`,雙擊 `palserver.exe` 會有數字選單(啟動/重啟/停止/狀態/只更新網站)。

## 🎛️ 調整伺服器參數:只改一個檔 `.env`

**所有** Palworld 參數(名稱、人數、密碼、經驗/捕捉/傷害倍率、孵蛋時間、PvP…約 50 項)都集中在專案根目錄的 `.env`,每一項在 [`.example.env`](.example.env) 都有英文註解說明。改完存檔 → 雙擊 `windows\restart.bat` 即套用:

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

1. 兩邊伺服器都先停止(`windows\stop.bat`)
2. 原存檔位置:Windows 專服 `PalServer\Pal\Saved\SaveGames\0\<GUID>`;Linux/Docker 同層級
3. 複製整個 `<GUID>` 資料夾到上面路徑
4. Linux 主機:`sudo chown -R 1000:1000 backend/palworld-data`
5. `windows\start.bat` → 網站右上 🔄 重新載入

> ⚠️ 不要直接改 `PalWorldSettings.ini` —— 每次開機會由 `.env` 重新產生。

## ⏰ 排程與廣播:`backend/config.json`

開服時段表與關服倒數廣播都在這(首次啟動自動產生;`config.example.json` 為範本):

| 欄位 | 說明 |
|---|---|
| `schedule.windows` | 開服時段表 —— **完整規則見下方小節** |
| `hooks.onClose.announce` | 關服前廣播:`{ "at": 600, "message": "10 分鐘後關服" }`,想改時間/文案只改這個陣列 |
| `api.token` | 網站後台呼叫排程器的密碼(自動隨機產生) |

改完:`docker compose restart scheduler`(或直接 `windows\restart.bat`)。

### `schedule.windows` 完整說明(開服時段表)

每一筆就是一個「開放時段」,可以放多筆:

```json
"windows": [
  { "label": "weekday-night", "days": ["Mon","Tue","Wed","Thu","Fri"], "open": "19:00", "close": "23:30" },
  { "label": "weekend",       "days": ["Sat","Sun"],                   "open": "10:00", "close": "03:00" }
]
```

| 欄位 | 規則 |
|---|---|
| `label` | 自由命名,純備註,不影響行為 |
| `days` | 這個時段套用在哪些「**開服當天**」。可寫 `Mon`/`Tue`/`Wed`/`Thu`/`Fri`/`Sat`/`Sun` 或英文全名(如 `Monday`),大小寫不拘 |
| `open` / `close` | `"HH:MM"`,小時 **0–23**、分 0–59(⚠️ 沒有 `24:00` 這種寫法) |

**行為規則:**

- `close` ≤ `open` ⇒ 關服時間自動落在**隔天**:`Sat 10:00 → 03:00` = 週六早上 10 點開到週日凌晨 3 點
- 跨午夜時 `days` 只需要列「開服那天」,不用把隔天也加進去
- 多筆時段可重疊、同一天可拆早晚兩段,效果等同取聯集
- **24 小時全年無休**:七天全列 + `"open": "00:00", "close": "00:00"`(close=open 視為隔天,即整整 24 小時)
- 某天完全不開(例:週三維護):不要把 `Wed` 放進任何一筆 `days` 即可
- 所有時間依 `.env` 的 `TZ` 時區計算
- 到 `open` 時間 → 執行 `hooks.onOpen`(啟動容器+歡迎廣播);到 `close` 時間 → 執行 `hooks.onClose`(倒數廣播→存檔→關機),倒數的**結尾**會對齊 close 時間
- 臨時手動接管:`POST /api/open`、`/api/close` 立即開/關,`/api/resume` 交還給排程(皆需 `api.token`)

## 🔄 遊戲改版後更新配種資料(選配)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # 配方
node scripts/fetch-pal-meta.mjs           # 屬性/圖鑑編號/稀有度
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## 🧱 沒有 Docker?改用 SteamCMD 版

不能(或不想)裝 Docker 的電腦,可以用 [`windows/native/`](windows/native) 的腳本直接開遊戲伺服器。
這個做法本文件稱為 **SteamCMD 版**(以前叫「原生模式」,容易誤會所以改名):

1. 雙擊 `windows\native\install.bat`(自動下載 SteamCMD + 伺服器本體)
2. 雙擊 `windows\native\start.bat` 啟動(Linux:`bash linux/native/install.sh` → `bash linux/start.sh`)
3. 設定改 `windows/native/server/Pal/Saved/Config/.../PalWorldSettings.ini`(SteamCMD 版不會被覆寫)

`start-all` 會一次帶起遊戲伺服器 + 排程器 + 存檔解析 + 查詢網站(<http://localhost:9000>),
和 Docker 版看到的網站完全一樣;只想要遊戲伺服器就用不加 `-all` 的 `start.bat`。
**兩邊存檔完全互通**,之後想升級整套,把世界資料夾搬到 `backend/palworld-data/` 即可(詳見 [docs/SteamCMD版.md](docs/SteamCMD版.md))。

### SteamCMD 要去哪下載?

**通常不用自己抓** —— 上面的 `install.bat` / `install.sh` 會自動下載。要手動裝再看這裡:

| 連結 | 用途 |
|---|---|
| [SteamCMD 官方說明(Valve Wiki)](https://developer.valvesoftware.com/wiki/SteamCMD) | 官方文件,各平台安裝方式都在這 |
| [**Windows 版下載(steamcmd.zip)**](https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip) | 解壓到任意資料夾,執行 `steamcmd.exe` |
| [Linux 版下載(steamcmd_linux.tar.gz)](https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz) | Debian/Ubuntu 另需 `sudo apt install -y curl lib32gcc-s1` |

Palworld 專用伺服器的 App ID 是 **2394010**,手動安裝指令:

```bash
steamcmd +force_install_dir <安裝路徑> +login anonymous +app_update 2394010 validate +quit
```

> 兩種版本的完整比較表在最上面的 [兩種版本,挑一個](#-兩種版本挑一個)。

## 🌐 查詢網站有什麼

開站後 <http://localhost>,不用登入就能看,所有資料直接讀伺服器存檔。

| 分頁 | 能做什麼 |
|---|---|
| 📊 總覽 | 在線人數、伺服器 FPS、遊戲天數、全服圖鑑收服率、Top 玩家與最熱門帕魯 |
| 🧑 玩家查詢 | **玩家地圖**(全員最後位置 + 公會據點,附座標)、每位玩家的等級/配點/全部帕魯 |
| 🐾 帕魯查詢 | 全服帕魯搜尋,可依屬性、詞條、工作適性、個體值篩選排序 |
| 🥚 配種表 | 最短路徑、配種計算、反查組合、配種樹、**變異配種**(見下) |
| 🏷️ 詞條查詢 | 用被動技能複合查詢(且/或),看誰身上有你要的詞條 |
| 📖 圖鑑收服率 | 全服與個人圖鑑進度,缺哪幾隻一目了然 |
| 👑 首領進度 | 塔主與野外首領的擊破狀況 |
| 🏆 排行榜 | 各種維度的排名 |
| 🕐 上線分析 | 玩家上線時段分布 |

右上角的 **🔄 更新鈕** 可切換手動或自動更新(5 秒 / 15 / 30 / 60 秒 / 5 分 / 10 分),
仿 Grafana 的作法:更新時畫面不會重來,地圖上的玩家會平滑滑到新位置。

## 🧬 配種表:四種找法

進「🥚 配種表」後,上排四張卡片各是一種找法:

- **🪜 最短路徑** —— 選「初代」與「目標」,列出一路配到目標的每一代 `A ＋ B ＝ C`。
  選好目標就會直接告訴你**有哪些帕魯能當初代**、各要幾代。
- **🥚 配種計算** —— 隨手選兩隻看生出什麼,可同時開多組。
- **🔄 反查組合** —— 看某隻帕魯的全部父母組合,或牠能當父母配出什麼。
- **🌳 帕魯配種樹** —— 樹狀展開,點節點就往下長,缺的帕魯顯示灰階。

### 直系 / 變異 三選一

「🪜 最短路徑」裡可以切換配種來源:

| 模式 | 說明 |
|---|---|
| **純粹帕魯配種** | 只走官方配方表,100% 生得出來 |
| **包含變異可能性** | 直系與突變都能用,優先代數少 |
| **純粹變異配種** | 全程靠突變蛋 |

選了後兩者會多出一顆 **⚙ 設定鈕**(蛋糕、產蛋設施、梁葉龍/寶寶保母加成),
每一步都會標示是「直系(必得)」還是「變異 + 機率」,並換算成
**每顆蛋機率 / 平均要幾顆 / 大概要多久**。還能切「代數最少」或「成功率最高」——
後者會挑期望蛋數最少的走法,常常多繞一代反而更省。

> 變異機率的算法與驗證方式寫在 [Wiki:變異配種](../../wiki/網站-變異配種)。

### 詞條篩選

在「🪜 最短路徑」按 **🏷️ 詞條** 或 **✨ 主動技能** 可複選(最多 4 個),
系統會用你(或全服)現有的帕魯排列組合,找出把這些詞條全部帶到目標身上的路線。
父母各帶一部分也可以(1:3、2:2 都行),子代會繼承雙親詞條的聯集。

## ❓ 常見問題

| 問題 | 解法 |
|---|---|
| 網站沒有玩家資料 | 存檔沒放對位置(見搬家章節),或伺服器還沒開過;放好後按網站 🔄 |
| 排程沒開服 | 檢查 `.env` 的 `TZ` 與 `config.json` 的 `schedule.windows`;`windows\status.bat` 看日誌 |
| 忘記密碼 | 打開根目錄 `.env` 就看得到;改完 `windows\restart.bat` |
| 埠被占用 | 80/8211/9000 改 compose 的 ports 左半邊 |

## 授權與致謝

- 配種配方:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT)
- 屬性/稀有度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- 伺服器映像:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- 其餘資料來源見 `frontend/packages/web/public/game-data/CREDITS.md`
