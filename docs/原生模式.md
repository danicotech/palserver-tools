# 🧱 SteamCMD 原生模式(不用 Docker)

沒有(或不想裝)Docker 的玩家,可以用這個資料夾的腳本,直接用 **SteamCMD** 在本機跑 Palworld 專用伺服器。

> **範圍說明**:原生模式提供「遊戲伺服器」的 安裝 / 啟動 / 停止 / 更新。
> 玩家查詢網站與自動排程開關服需要 Docker(見主 README 的三步驟開服);
> 兩邊的**存檔格式完全相同**,之後想升級到 Docker 全家桶,把存檔搬過去即可(見下方)。

## Windows

| 動作 | 雙擊 |
|---|---|
| 第一次安裝(自動下載 SteamCMD + 伺服器) | `windows\install.bat` |
| 啟動伺服器 | `windows\start.bat` |
| 停止伺服器 | `windows\stop.bat` |
| 更新伺服器(遊戲改版後) | `windows\update.bat` |

安裝後:

- 伺服器本體:`native\server\`
- **設定檔**:`native\server\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini`
  (第一次啟動會自動從 `DefaultPalWorldSettings.ini` 複製;原生模式直接改這個檔,改完重開伺服器)
- **存檔**:`native\server\Pal\Saved\SaveGames\0\<世界GUID>\`

## Linux

```bash
cd native/linux
./install.sh   # 下載 SteamCMD + 安裝伺服器(Debian/Ubuntu 會提示需要的套件)
./start.sh     # 啟動
./stop.sh      # 停止
./update.sh    # 更新
```

路徑同 Windows(`native/server/...`,設定檔資料夾為 `LinuxServer`)。

## 🔁 與 Docker 全家桶互搬存檔

兩邊存檔互通,搬「整個世界 GUID 資料夾」即可(搬之前兩邊都先停止):

| 方向 | 從 | 到 |
|---|---|---|
| 原生 → Docker | `native/server/Pal/Saved/SaveGames/0/<GUID>` | `backend/palworld-data/Pal/Saved/SaveGames/0/` |
| Docker → 原生 | `backend/palworld-data/Pal/Saved/SaveGames/0/<GUID>` | `native/server/Pal/Saved/SaveGames/0/` |

Linux 搬進 Docker 後記得:`sudo chown -R 1000:1000 backend/palworld-data`

## 常見問題

| 問題 | 解法 |
|---|---|
| install 下載很慢/失敗 | Steam CDN 波動,重跑一次 `install.bat` 即可續傳 |
| 朋友連不進來 | 防火牆/路由器開放 **UDP 8211**;雲端主機開安全群組 |
| 想改伺服器名稱/密碼/倍率 | 編輯 `PalWorldSettings.ini` 對應欄位(原生模式不會被覆寫),重開伺服器 |
| Linux 缺函式庫 | `sudo apt install -y curl lib32gcc-s1`(SteamCMD 需要) |
