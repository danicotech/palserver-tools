# 帕魯玩家查詢工具網(Palworld 伺服器全家桶)

一套 **Docker 一鍵部署** 的 Palworld 專用伺服器 + 玩家查詢網站:

- 🖥️ **Palworld 專用伺服器**(社群映像 `thijsvanloef/palworld-server-docker`)
- ⏰ **自動排程開關服**(Go 排程器:時段開關、開/關服廣播倒數、崩潰自動重啟)
- 🌐 **玩家查詢網站**(本專案重點,玩家用瀏覽器就能看):
  - 📊 總覽儀表板(玩家數/帕魯總數/開服狀態/收服率)
  - 🧑 玩家查詢、🐾 帕魯查詢(全服搜尋 + 物種報表)、🏷️ 詞條查詢
  - 🥚 **配種表**:配種計算(多組 A+B=C)、反查組合、**帕魯配種樹**(互動樹狀規劃 / 最短路徑 / 玩家視角標記已擁有與缺少)
  - 📖 圖鑑收服率、👑 首領進度、🏆 排行榜、🕐 上線分析
  - 🌍 四語介面(繁中/簡中/英/日)

配種資料:299 隻可配種帕魯 × 44,851 筆配方全覆蓋(來源 [tylercamp/palcalc](https://github.com/tylercamp/palcalc),MIT)。

---

## 系統需求

- 任一台能跑 **Docker + Docker Compose v2** 的機器(Windows 用 Docker Desktop / Linux 直接裝 docker)
- 8GB+ RAM(Palworld 伺服器本身吃 6GB 上下)

## 快速開始(5 分鐘)

```bash
git clone <你的-repo-網址>
cd palworld-panel

# 1) 建立後端設定檔(從範本複製)
cp backend/config.example.json backend/config.json
#    → 打開 backend/config.json,把 api.token 改成長隨機字串、rcon.password 改成你的管理密碼

# 2) 在專案根目錄建立 .env,填入密碼(compose 會自動讀取):
cat > .env <<'ENV'
ADMIN_PASSWORD=你的管理密碼        # 需與 config.json 的 rcon.password 一致
SERVER_PASSWORD=玩家進服密碼
PUBLIC_IP=                        # 固定對外 IP;浮動可留空
ENV
#    伺服器名稱、各種倍率等其餘參數在 backend/docker-compose.yml 的 environment 區塊

# 3) 一鍵啟動(伺服器 + 排程器 + 存檔解析 + 查詢網站)
docker compose up -d --build
```

完成後:

| 服務 | 位址 |
|---|---|
| 玩家查詢網站 | http://localhost(或你的主機 IP) |
| Palworld 遊戲連線 | `你的IP:8211`(UDP) |
| 排程器 API | http://localhost:9000(需 token) |

> 💡 想讓外網玩家看到網站:在主機自行架設反向代理或隧道指向本機 80 埠即可;也可以新增一個 gitignored 的 `docker-compose.override.yml` 疊加你自己的對外服務,不會影響本專案檔案。

---

## 🚚 無痛搬家:把「你自己伺服器的存檔」換進來

整個系統讀的存檔只有一個位置:**`backend/palworld-data/`**(掛載進容器的 `/palworld`)。
把你原本伺服器的存檔複製進來,查詢網站的所有資料(玩家、帕魯、圖鑑、排行)就會變成你的伺服器。

存檔的實際層級長這樣:

```
backend/palworld-data/
└── Pal/
    └── Saved/
        ├── Config/LinuxServer/PalWorldSettings.ini   ← 每次開機由 compose 環境變數重新產生,不用手動搬
        └── SaveGames/
            └── 0/
                └── <你的世界GUID>/                    ← ★ 把整個資料夾搬進來就對了
                    ├── Level.sav                      (世界主存檔)
                    ├── LevelMeta.sav
                    └── Players/*.sav                  (每位玩家)
```

### 步驟

1. **先關掉伺服器**(來源與目的兩邊都要):`docker compose stop palworld`
2. 找到你原伺服器的 `SaveGames/0/<世界GUID>` 資料夾:
   - 原本就是 Docker(同款社群映像):在原機的掛載目錄底下,整個 `Pal/Saved/SaveGames` 複製過來
   - Windows 專用伺服器:`PalServer\Pal\Saved\SaveGames\0\<GUID>`
   - Linux 專用伺服器:`PalServer/Pal/Saved/SaveGames/0/<GUID>`
3. 複製到本專案 `backend/palworld-data/Pal/Saved/SaveGames/0/` 底下(整個 GUID 資料夾)
4. Linux 主機記得把擁有者對齊 compose 的 PUID/PGID(預設 1000):
   `sudo chown -R 1000:1000 backend/palworld-data`
5. `docker compose up -d` 重新啟動 → 進網站按右上角 🔄 重新載入,資料就是你的伺服器了

> ⚠️ 遊戲性設定(倍率、人數上限…)**不要**直接改 `PalWorldSettings.ini` —— 容器每次啟動會用
> `backend/docker-compose.yml` 的環境變數重新產生它。要調整請改 compose 檔裡對應的變數。

---

## 🔧 後端設定檔說明:`backend/config.json`

一般人只需要動 ★ 標記的欄位,其餘保持預設即可。

| 區塊 | 欄位 | 說明 |
|---|---|---|
| `timezone` | | 排程使用的時區,例 `Asia/Taipei` |
| `docker` | `containerName` | 要被開/關的遊戲容器名(對應 compose 的 `container_name: palworld`,不用改) |
| `rcon` | ★ `password` | RCON 管理密碼,**必須等於** compose 的 `ADMIN_PASSWORD` |
| `rest` | `enabled` | 走官方 REST API 廣播/查線上玩家(預設開,不用改) |
| `palsave` | `enabled` | 存檔解析服務(查詢網站的資料來源),**保持 true** |
| `api` | ★ `token` | 排程器 API 的密碼,改成長隨機字串(網站後台呼叫用) |
| `schedule` | ★ `windows` | **開服時段表**。每筆 = 星期幾 + 開/關時間,跨午夜自動處理。例:<br>`{ "label": "weekend", "days": ["Sat","Sun"], "open": "10:00", "close": "03:00" }`<br>想 24 小時開服就設 `"open": "00:00", "close": "24:00"` 全週 |
| `hooks` | `onOpen` | 開服流程(依序執行):啟動容器 → 等 30 秒 → 廣播歡迎詞。改 `message` 即可自訂 |
| `hooks` | ★ `onClose` | 關服流程。`countdown.announce` 陣列 = 「剩幾秒時廣播什麼」,想改提醒時間/文案**只改這個陣列**,例:<br>`{ "at": 600, "message": "伺服器將於 10 分鐘後關閉" }` |
| `hooks` | `onManualStop` | 手動關服(API 觸發)的流程,預設 15 秒倒數後存檔關機 |

`hooks` 可用的步驟型別:`startContainer`、`stopContainer`、`broadcast`、`wait`、`countdown`、`save`、`doexit`、`rcon`(任意指令)…,像堆積木一樣自由編排,存檔後重啟 scheduler 生效:

```bash
docker compose restart scheduler
```

## 🎛️ 遊戲參數:`backend/docker-compose.yml`

伺服器名稱、密碼、各種倍率(經驗/捕捉率/傷害/孵蛋時間…)全部在 `palworld` 服務的
`environment:` 區塊,每個變數旁都有中文註解。改完:

```bash
docker compose up -d palworld   # 重建遊戲容器套用
```

---

## 📅 資料更新(改版後跑一次即可,選配)

遊戲大改版新增帕魯時,在 `frontend/` 執行:

```bash
node scripts/fetch-palcalc-breeding.mjs   # 更新 44,851 筆配種配方(palcalc)
node scripts/fetch-pal-meta.mjs           # 更新屬性/圖鑑編號/稀有度
pnpm build                                 # 重新建置前端
cd .. && docker compose up -d --no-deps --build panel
```

## ❓ 常見問題

| 問題 | 解法 |
|---|---|
| 網站打開沒有玩家資料 | 存檔還沒放對位置(見「無痛搬家」),或伺服器從未開過(沒有存檔);放好後按網站右上 🔄 |
| 排程沒有開服 | 檢查 `config.json` 的 `timezone` 與 `schedule.windows`;`docker compose logs -f scheduler` 看日誌 |
| 廣播沒出現 | `ADMIN_PASSWORD` 與 `rcon.password` 不一致,兩邊改成一樣後重啟 |
| 想手動立刻開/關服 | `curl -H "Authorization: Bearer <token>" -X POST http://localhost:9000/api/open`(`/close`、`/resume` 同理;詳見 `backend/README.md`) |
| 埠被占用 | 80(網站)/8211(遊戲)/9000(API)任一被占用時,改上層或 backend compose 的 ports 映射左半邊 |

## 🔐 發佈到 Git 前的檢查清單

`.gitignore` 已排除存檔(`backend/palworld-data/`)、統計資料(`backend/data/`)、`.env` 與 `backend/config.json`(只進版控 `config.example.json`)。**推上去之前再確認**:

- [ ] `backend/docker-compose.yml`:`ADMIN_PASSWORD` / `SERVER_PASSWORD` / `PUBLIC_IP` 改成佔位值或範例值
- [ ] `git status` 沒有列出 `palworld-data`、`.env`、`config.json`
- [ ] `git rm --cached` 清掉任何已被追蹤的敏感檔(若曾 commit 過)

## 授權與致謝

- 配種配方資料:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT,v26/v27)
- 帕魯屬性/稀有度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- 伺服器映像:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- 其餘資料來源見 `frontend/packages/web/public/game-data/CREDITS.md`
