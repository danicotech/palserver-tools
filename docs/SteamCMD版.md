# 🧱 SteamCMD 版(只跑遊戲伺服器,不用 Docker)

沒有(或不想裝)Docker 的玩家,可以用 `windows\native\` / `linux/native/` 裡的腳本,
直接用 **SteamCMD** 在本機跑 Palworld 專用伺服器。

> **範圍說明**:SteamCMD 版提供「遊戲伺服器」的 安裝 / 啟動 / 停止 / 更新。
> 玩家查詢網站與自動排程開關服需要 Docker(見主 README 的三步驟開服);
> 兩邊的**存檔格式完全相同**,之後想升級成 Docker 版,把存檔搬過去即可(見下方)。

## Windows

腳本在 **`windows\native\`** 資料夾裡(不是 `native\windows\`):

| 動作 | 雙擊 |
|---|---|
| 第一次安裝(自動下載 SteamCMD + 伺服器) | `windows\native\install.bat` |
| 啟動伺服器 | `windows\native\start.bat` |
| 停止伺服器 | `windows\native\stop.bat` |
| 更新伺服器(遊戲改版後) | `windows\native\update.bat` |

安裝後:

- SteamCMD 本體:`windows\native\steamcmd\`
- 伺服器本體:`windows\native\server\`
- **設定檔**:`windows\native\server\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini`
  (第一次啟動會自動從 `DefaultPalWorldSettings.ini` 複製;SteamCMD 版直接改這個檔,改完重開伺服器)
- **存檔**:`windows\native\server\Pal\Saved\SaveGames\0\<世界GUID>\`

## 🚀 不用 Docker 也能跑「完整服務」

`start-all` 會一次帶起四項服務,和 Docker 版看到的網站完全一樣:

| 服務 | 由誰跑 | 說明 |
|---|---|---|
| 遊戲伺服器 | SteamCMD 裝的 `PalServer` | 由排程器依時段表**自動開關**(不透過 Docker,直接管行程) |
| 排程器 | `backend/palscheduler` | 開關服、關服倒數廣播、RCON / 官方 REST |
| 存檔解析 | `python server.py` | 玩家 / 帕魯 / 公會資料的來源;由排程器當**子行程**帶起,不另開視窗 |
| 查詢網站 | 排程器直接提供 | 同源提供靜態檔 + API,不需要 nginx |

啟動後桌面上**只會有一個視窗**(標題「帕魯服務執行中」),存檔解析與排程器的訊息都印在裡面。
關掉它就等於停止服務。遊戲伺服器本身是獨立行程,不佔視窗。
訊息另外落地在 `backend/data/logs/`(Windows 只有 `palsave.log`,排程器的訊息在視窗裡;
Linux 是背景執行,兩份都寫成檔案)。

```bat
:: Windows
windows\native\start-all.bat        :: 全部啟動 → http://localhost:9000
windows\native\stop-all.bat         :: 全部停止
```

```bash
# Linux / macOS
bash linux/native/start-all.sh       # 全部啟動 → http://localhost:9000
bash linux/native/stop-all.sh        # 全部停止
```

> 直接雙擊 `windows\start.bat`(或 `bash linux/start.sh`)也可以 ——
> 偵測不到 Docker 時它會問你要不要改用 SteamCMD 版,答 Y 就走這條路。

### 需要先裝什麼

| 需求 | 用途 | 沒有的話 |
|---|---|---|
| **Python 3.10+** | 解析存檔(玩家/帕魯資料) | 網站起得來,但沒有玩家與帕魯資料 |
| **Go 1.21+** | 編譯排程器(只有第一次) | 無法開關服與提供網站 |
| **Node.js + pnpm** | 建置查詢網站(只有第一次) | 沒有網站 |

腳本會自動檢查、自動安裝 Python 套件、自動建置網站與編譯排程器;缺哪一個都會明確告訴你去哪裝。
`pyooz` 與 `palworld-save-tools` 都有現成的 Windows / Linux wheel,不需要編譯器。

### 和 Docker 版的差別

只差在「誰來跑這些服務」:

| | Docker 版 | SteamCMD 版 |
|---|---|---|
| 網址 | `http://localhost`(nginx) | `http://localhost:9000`(排程器直接提供) |
| 開關伺服器 | Docker Engine API | 直接管本機行程(`procctl`) |
| 要裝的東西 | 只要 Docker Desktop | Python + Go + Node(首次) |
| 存檔位置 | `backend/palworld-data/` | `windows\native\server\` |

唯讀端點(玩家、帕魯、狀態、頭像名冊)在同源時免 token,
控制端點(開關服、RCON、踢人…)一律仍需 token —— 與 Docker 版的 nginx 白名單完全一致。

## Linux

```bash
cd linux/native
./install.sh   # 下載 SteamCMD + 安裝伺服器(Debian/Ubuntu 會提示需要的套件)
./start.sh     # 啟動
./stop.sh      # 停止
./update.sh    # 更新
```

路徑對應 Windows:`linux/native/server/...`,設定檔資料夾為 `LinuxServer`。

## 🔁 與 Docker 版互搬存檔

兩邊存檔互通,搬「整個世界 GUID 資料夾」即可(搬之前兩邊都先停止):

| 方向 | 從 | 到 |
|---|---|---|
| SteamCMD 版 → Docker 版 | `windows\native\server\Pal\Saved\SaveGames\0\<GUID>` | `backend\palworld-data\Pal\Saved\SaveGames\0\` |
| Docker 版 → SteamCMD 版 | `backend\palworld-data\Pal\Saved\SaveGames\0\<GUID>` | `windows\native\server\Pal\Saved\SaveGames\0\` |

Linux 把路徑換成 `linux/native/server/...`;搬進 Docker 後記得
`sudo chown -R 1000:1000 backend/palworld-data`。

完整圖解(含來源在哪、指令、常見坑)見 [windows/README.md](../windows/README.md) 或
[linux/README.md](../linux/README.md) 的「已經有伺服器?把存檔搬過來」。

## 常見問題

| 問題 | 解法 |
|---|---|
| install 下載很慢/失敗 | Steam CDN 波動,重跑一次 `install.bat` 即可續傳 |
| 出現 `'cmd.zip' 不是內部或外部命令`、多出名為 `(` 的資料夾 | 你的 `.bat` 換行被改成 LF 了。重新 `git clone`(本專案已用 `.gitattributes` 強制 CRLF),或用 VS Code 右下角把換行改成 **CRLF** 存檔;順手刪掉誤建的 `(` 資料夾與別的磁碟根目錄下的 `steamcmd` 資料夾 |
| 朋友連不進來 | 防火牆/路由器開放 **UDP 8211**;雲端主機開安全群組 |
| 想改伺服器名稱/密碼/倍率 | 編輯 `PalWorldSettings.ini` 對應欄位(SteamCMD 版不會被覆寫),重開伺服器 |
| Linux 缺函式庫 | `sudo apt install -y curl lib32gcc-s1`(SteamCMD 需要) |
