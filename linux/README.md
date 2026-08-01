# Linux / macOS 使用者

```bash
bash linux/start.sh
```

| 檔案 | 用途 |
|---|---|
| `start.sh` | **一鍵啟動** —— 首次會自動產生設定檔與隨機密碼,然後啟動全部服務 |
| `restart.sh` | 重新啟動全部服務(改完設定用這個) |
| `stop.sh` | 停止全部服務(存檔會保留) |
| `status.sh` | 查看目前狀態與連線資訊 |
| `setup.sh` | 產生 `.env` 與 `backend/config.json`(由 `start.sh` 自動呼叫,通常不用自己執行) |

啟動後:

- 查詢網站 <http://localhost>
- 遊戲連線 `你的IP:8211`

## 沒有 Docker?

`native/` 資料夾是不需要 Docker 的原生模式(用 SteamCMD 直接跑伺服器),
詳見 [docs/原生模式.md](../docs/原生模式.md)。

## 常見狀況

- **`permission denied`** —— 先 `chmod +x linux/*.sh`,或一律用 `bash linux/start.sh` 執行。
- **`docker: command not found`** —— 依 [官方文件](https://docs.docker.com/engine/install/) 安裝 Docker Engine。
- **想改伺服器參數** —— 編輯專案根目錄的 `.env`,再跑 `bash linux/restart.sh`。
