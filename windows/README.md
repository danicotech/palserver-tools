# Windows 使用者

雙擊即可,不需要打指令。

| 檔案 | 用途 |
|---|---|
| `start.bat` | **一鍵啟動** —— 首次會自動產生設定檔與隨機密碼,然後啟動全部服務 |
| `restart.bat` | 重新啟動全部服務(改完設定用這個) |
| `stop.bat` | 停止全部服務(存檔會保留) |
| `status.bat` | 查看目前狀態與連線資訊 |
| `setup.ps1` | 產生 `.env` 與 `backend/config.json`(由 `start.bat` 自動呼叫,通常不用自己執行) |

啟動後:

- 查詢網站 <http://localhost>
- 遊戲連線 `你的IP:8211`

## 沒有 Docker?

`native\` 資料夾是不需要 Docker 的原生模式(用 SteamCMD 直接跑伺服器),
詳見 [docs/原生模式.md](../docs/原生模式.md)。

## 常見狀況

- **跳出「找不到 Docker」** —— 先安裝並啟動 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。
- **視窗一閃就關** —— 改成在資料夾空白處按右鍵 →「在終端中開啟」,再輸入 `windows\start.bat`,就看得到訊息。
- **想改伺服器參數** —— 編輯專案根目錄的 `.env`,再跑 `restart.bat`。
