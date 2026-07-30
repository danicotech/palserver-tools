# Palworld Scheduler (Docker + Gin + Wire)

一個常駐的 Go 服務，**只靠這一支就能完整維運 Palworld 伺服器**：

- 依開放時段自動開/關 Palworld 容器
- **開/關服流程用 JSON array 自由編排**（廣播、倒數、存檔、關閉、任意 RCON…）
- 關服前依編排通知玩家（預設 10 / 5 / 1 分鐘提醒 + 最後 15 秒逐秒倒數）
- 開放時段內監控容器，**崩潰自動重啟**
- **HTTP API**：從外部主動開/關/恢復自動，並開放**完整 RCON** 能力

## 架構
```
docker-compose
├── palworld     社群映像 thijsvanloef/palworld-server-docker（RCON 開啟）
└── scheduler    本專案（Go + Gin + Wire），一直運行
      ├─ /var/run/docker.sock  →  docker start/stop palworld
      ├─ RCON (palworld:25575) →  Broadcast / Save / DoExit / Kick / Ban ...
      └─ :9000 HTTP API        →  外部主動控制 + 完整 RCON
```

## 專案結構
```
palscheduler/
├── cmd/scheduler/   進入點 + Google Wire (wire.go / wire_gen.go / providers.go)
├── internal/
│   ├── config/      設定載入與驗證
│   ├── dockerctl/   Docker Engine API 客戶端（開/關容器）
│   ├── rcon/        Source RCON 協定客戶端
│   ├── scheduler/   排程 + JSON 流程引擎 + 覆寫 + RCON
│   ├── api/         Gin HTTP API（token 驗證）
│   └── app/         生命週期組裝
├── config.json  Dockerfile  docker-compose.yml
```

## 快速開始
```bash
# 1) 改 config.json 的 api.token
# 2) 改 docker-compose.yml 的 ADMIN_PASSWORD / SERVER_PASSWORD（ADMIN_PASSWORD 要 = config.json rcon.password）
docker compose up -d --build
docker compose logs -f scheduler
```

## 開/關服流程：JSON array 編排（config.json → hooks）
三個可編排的流程，各是一連串 **Step**，依序執行：
- `hooks.onOpen`：開服時執行
- `hooks.onClose`：**排程**關服時執行（整段結尾對齊 close 時間 → 服務會提前 `Σ(wait+countdown)` 秒開始跑）
- `hooks.onManualStop`：由 `POST /api/stop` 觸發的關服流程

### Step 型別
| type | 參數 | 動作 |
|------|------|------|
| `startContainer` | – | `docker start` 容器 |
| `stopContainer` | – | `docker stop` 容器 |
| `broadcast` | `message` | RCON `Broadcast`（空白用 `_`） |
| `wait` | `seconds` | 等待 N 秒 |
| `countdown` | `fromSeconds`, `prefix` | 最後 N 秒逐秒廣播 `prefix_N`…`prefix_1` |
| `save` | – | RCON `Save` |
| `doexit` | – | RCON `DoExit`（立即關閉） |
| `shutdown` | `seconds`, `message` | RCON `Shutdown`（伺服器自行倒數+存檔+關閉） |
| `rcon` | `command` | 任意 RCON 指令 |
| `info` / `showplayers` | – | 查詢類，結果寫入日誌 |

範例（關服前 10/5/1 分提醒 + 15 秒倒數）：
```json
"onClose": [
  { "type": "broadcast", "message": "Server_will_close_in_10_minutes" },
  { "type": "wait", "seconds": 300 },
  { "type": "broadcast", "message": "Server_will_close_in_5_minutes" },
  { "type": "wait", "seconds": 240 },
  { "type": "broadcast", "message": "Server_will_close_in_1_minute" },
  { "type": "wait", "seconds": 45 },
  { "type": "countdown", "fromSeconds": 15, "prefix": "Server_closing_in" },
  { "type": "save" },
  { "type": "doexit" },
  { "type": "wait", "seconds": 10 },
  { "type": "stopContainer" }
]
```

## API 文件（Swagger / OpenAPI）
啟動後可直接瀏覽互動式文件（免 token 即可查看）：

| 網址 | 說明 |
|------|------|
| `http://伺服器IP:9000/openapi/view` | **Swagger UI**：點右上 **Authorize** 填 token 後，可對每個端點 **Try it out** 直接調用 |
| `http://伺服器IP:9000/openapi` | OpenAPI 3.0 規格（JSON），可匯入 Postman / 產生 client |

## HTTP API
所有 `/api/*` 需帶 token：標頭 `X-Auth-Token`、`Authorization: Bearer`、或 `?token=`。

### 排程覆寫
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/status` | 目前模式、是否執行、目前/下一時段 |
| POST | `/api/start` | 強制開啟（FORCE_ON，忽略排程至 `/api/auto`） |
| POST | `/api/stop?countdown=15` | 強制關閉（跑 onManualStop；countdown 覆寫倒數） |
| POST | `/api/auto` | 恢復自動排程 |

### 完整 RCON（Palworld 官方 13 個指令）
| 方法 | 路徑 | 對應 RCON | 備註 |
|------|------|-----------|------|
| POST | `/api/rcon?command=...`（或 JSON `{"command":"..."}`） | 任意指令 | 萬用通道 |
| GET | `/api/info` | `Info` | |
| GET | `/api/players` | `ShowPlayers` | CSV: name,uid,steamid |
| POST | `/api/save` | `Save` | |
| POST | `/api/broadcast?msg=Hello_all` | `Broadcast` | 空白用 `_` |
| POST | `/api/kick?steamid=...` | `KickPlayer` | |
| POST | `/api/ban?steamid=...` | `BanPlayer` | |
| POST | `/api/unban?steamid=...` | `UnBanPlayer` | |
| POST | `/api/shutdown?seconds=60&message=Bye` | `Shutdown` | |
| POST | `/api/doexit` | `DoExit` | 立即關閉 |
| POST | `/api/teleport?steamid=...&mode=tome\|toplayer` | `TeleportToMe/Player` | ⚠️ 需遊戲內管理員 |
| POST | `/api/spectate` | `ToggleSpectate` | ⚠️ 需遊戲內管理員 |
| POST | `/api/adminpassword?password=...` | `AdminPassword` | ⚠️ RCON 已驗證，通常不需 |

> 前 10 個經 RCON 可正常使用；最後 3 個需要遊戲內管理員情境，透過 RCON 多半無效，仍保留為通道。

### 官方 REST API 代理（port 8212，回應為結構化 JSON）
掛在 `/api/rest/*`，內部呼叫 Palworld 內建 REST API（`RESTAPIEnabled=True`）。相較 RCON 回應為 JSON、較穩定，且能取得等級/座標/FPS/天數等 RCON 拿不到的資料。可用 `config.json` 的 `rest.enabled` 關閉（預設啟用；host/password 省略時沿用 `rcon`）。

| 方法 | 路徑 | 對應官方端點 | 備註 |
|------|------|-------------|------|
| GET | `/api/rest/info` | `GET /v1/api/info` | 版本、名稱、世界 GUID |
| GET | `/api/rest/players` | `GET /v1/api/players` | 含等級/座標/ping/建築數；`userId` 用於 kick/ban |
| GET | `/api/rest/metrics` | `GET /v1/api/metrics` | FPS、線上人數、運行秒數、據點數、天數 |
| GET | `/api/rest/settings` | `GET /v1/api/settings` | 目前生效設定 |
| POST | `/api/rest/announce?msg=Hello`（或 JSON `{"message":"..."}`） | `POST /v1/api/announce` | 訊息可含空白 |
| POST | `/api/rest/kick?userid=...&message=...` | `POST /v1/api/kick` | |
| POST | `/api/rest/ban?userid=...&message=...` | `POST /v1/api/ban` | |
| POST | `/api/rest/unban?userid=...` | `POST /v1/api/unban` | |
| POST | `/api/rest/save` | `POST /v1/api/save` | |
| POST | `/api/rest/shutdown?seconds=60&message=Bye` | `POST /v1/api/shutdown` | 伺服器自行倒數 |
| POST | `/api/rest/stop` | `POST /v1/api/stop` | 立即強制停止 |

> REST 未啟用時（`rest.enabled=false` 或伺服器未開 `RESTAPIEnabled`）呼叫上述端點回 `503`；REST 呼叫失敗回 `502`。

### 玩家帕魯資料（解析存檔）
RCON/REST 都拿不到帕魯資料；帕魯存在 `Level.sav` 裡，需解析存檔。由 `palsave` sidecar（Python，見 [tools/palsave/](tools/palsave/)）負責，scheduler 以 `/api/pals` 代理。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/pals/players` | **玩家清單摘要**（name/uid/level/exp/hp/配點/座標/pal_count…，不含每隻帕魯）。先用這個拿 UID |
| GET | `/api/pals` | 全部玩家的完整帕魯（種類繁中/英名、屬性、圖鑑、IV、靈魂、技能、被動…） |
| GET | `/api/pals?uuid=<UUID\|名稱>` | 只查符合的玩家（部分比對；UUID 由上一列取得） |

- 支援新版 **PlM(Oodle)** 壓縮存檔；結果依存檔 mtime 快取。
- `palsave` 服務唯讀掛入 `palworld-data`，自動依 `DedicatedServerName` 找目前世界。
- 未啟用（`palsave.enabled=false`）回 `503`，sidecar 呼叫失敗回 `502`。

```bash
curl -s "$BASE/api/pals?q=超濃狗" -H "X-Auth-Token: $TOKEN"
```

範例：
```bash
TOKEN=你的token ; BASE=http://伺服器IP:9000
curl -s "$BASE/api/status?token=$TOKEN"
curl -s -X POST "$BASE/api/stop?countdown=30" -H "X-Auth-Token: $TOKEN"
curl -s     "$BASE/api/players"               -H "X-Auth-Token: $TOKEN"
curl -s -X POST "$BASE/api/kick?steamid=1234" -H "X-Auth-Token: $TOKEN"
curl -s -X POST "$BASE/api/rcon" -H "X-Auth-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"command":"Broadcast GLHF"}'
```

## 控制模式
- **AUTO**：完全依 `schedule.windows` 自動開關（跑 onOpen/onClose）。
- **FORCE_ON**：`/api/start` 後強制開啟，忽略排程關服，直到 `/api/auto`。
- **FORCE_OFF**：`/api/stop` 後強制關閉（跑 onManualStop），直到 `/api/auto` 或 `/api/start`。

> 廣播與倒數已改走官方 REST（`announce`），訊息可直接用空白。只有直接下 RCON `Broadcast` / `Shutdown` 時空白才會被截斷（需用底線 `_`）。
> `/api/players` 也已改走 REST（RCON `ShowPlayers` 遇中文玩家名會逾時，見下）。

## 倒數廣播設定（只改 config.json）
關服前的倒數通知是 `onClose` 裡的 `countdown` 步驟，**操作員只要編輯 JSON**、不必動程式。建議用「宣告式」寫法：`announce` 陣列列出「剩餘幾秒、廣播什麼」，`tickFromSeconds` 設定最後幾秒逐秒倒數。

```json
{
  "type": "countdown",
  "announce": [
    { "at": 1800, "message": "伺服器將於 30 分鐘後關閉" },
    { "at": 600,  "message": "伺服器將於 10 分鐘後關閉" },
    { "at": 300,  "message": "伺服器將於 5 分鐘後關閉" },
    { "at": 60,   "message": "伺服器將於 1 分鐘後關閉" }
  ],
  "tickFromSeconds": 15,
  "tickPrefix": "伺服器將於"
}
```

- `at`：距關服的**剩餘秒數**（30 分=1800、10 分=600、5 分=300、1 分=60）。想要什麼頻率就列什麼，完全自訂。
- `tickFromSeconds`：最後 N 秒每秒廣播一次（例：`伺服器將於 15`…`伺服器將於 1`）。
- 倒數總長 = `announce` 最大的 `at`；排程會自動提前這麼多秒開始，讓倒數結尾正好對齊關服時間（故開放時段長度需 ≥ 倒數總長）。
- 相容舊寫法：`{ "type":"countdown", "fromSeconds":15, "prefix":"..." }` 仍可用（最後 15 秒逐秒）。

## 重新產生 Wire（可選）
```bash
go run github.com/google/wire/cmd/wire@latest ./cmd/scheduler
```

## 安全
- `api.token` 務必改成長隨機字串；`listen: 0.0.0.0` 代表對外，請用防火牆限制來源。
- RCON 埠（25575）預設不對外，僅 compose 內網供 scheduler 使用。
