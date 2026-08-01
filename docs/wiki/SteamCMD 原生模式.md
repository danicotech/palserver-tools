# 🧱 SteamCMD 原生模式(不用 Docker)

沒有 Docker 的電腦也能開遊戲伺服器 —— 用 `native/` 資料夾的腳本。

> 範圍:遊戲伺服器的 安裝/啟動/停止/更新。查詢網站與自動排程仍需 Docker;
> 兩邊**存檔完全互通**(見 [[存檔搬家]]),之後可無痛升級整套。

## Windows

| 動作 | 雙擊 |
|---|---|
| 第一次安裝(自動下載 SteamCMD+伺服器) | `windows\native\install.bat` |
| 啟動 | `windows\native\start.bat` |
| 停止 | `windows\native\stop.bat` |
| 更新(遊戲改版後) | `windows\native\update.bat` |

## Linux

```bash
cd linux/native
bash install.sh && bash start.sh     # 停止 bash stop.sh;更新 bash update.sh
```

## 路徑

- 伺服器本體:`windows/native/server/`
- 設定檔:`windows/native/server/Pal/Saved/Config/WindowsServer(或 LinuxServer)/PalWorldSettings.ini` —— 首次啟動自動建立,**原生模式直接編輯它**,改完重開
- 存檔:`windows/native/server/Pal/Saved/SaveGames/0/<GUID>/`

## 常見問題

| 問題 | 解法 |
|---|---|
| 下載慢/失敗 | 重跑 `install.bat` 可續傳 |
| 朋友連不進來 | 開放 UDP 8211(防火牆/路由器/雲端安全群組) |
| Linux 缺函式庫 | `sudo apt install -y curl lib32gcc-s1` |
