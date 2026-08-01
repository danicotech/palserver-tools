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

## 🚚 已經有伺服器?把存檔搬過來

![Linux 存檔搬家](../docs/wiki/svg/migrate-linux.svg)

本專案只讀一個位置:`backend/palworld-data/`。
所謂「搬家」就是把舊伺服器的**世界資料夾**(名字是一長串 GUID)整包複製過去。

### 0. 系統是讀哪個檔案?

查詢網站上的**玩家、帕魯、公會與據點,全部來自同一個檔**:

```text
backend/palworld-data/Pal/Saved/SaveGames/0/<世界GUID>/Level.sav
```

要怎麼在多個世界資料夾中挑到「就是它」,規則是:

1. 先讀 `backend/palworld-data/Pal/Saved/Config/LinuxServer/GameUserSettings.ini` 的
   `DedicatedServerName=`,用它指到的資料夾找 `Level.sav`
2. 找不到才退而求其次:挑 `SaveGames/0/` 底下**最後修改時間最新**的那份 `Level.sav`

> 所以只要 `Level.sav` 搬對位置,網站就讀得到 —— 不需要動資料庫,也沒有匯入步驟。
> 解析結果會依 `Level.sav` 的修改時間快取,存檔沒變就不重解;
> 存檔更新後在網站右上角按 🔄 就會重新讀取(公會/據點另有一份低頻背景快取,可能慢一輪)。

### 1. 先找到舊存檔在哪

| 來源 | 世界資料夾位置 |
|---|---|
| 其他 Linux 專用伺服器 | `~/PalServer/Pal/Saved/SaveGames/0/<世界GUID>` |
| 其他 Docker 映像 | 該容器掛載目錄下的 `Pal/Saved/SaveGames/0/<世界GUID>` |
| Windows 專用伺服器 | `PalServer\Pal\Saved\SaveGames\0\<世界GUID>` |
| **本機共玩存檔(4 人邀請碼)** | Windows 上的 `%LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<世界GUID>` |
| 本專案的 SteamCMD 版 | `linux/native/server/Pal/Saved/SaveGames/0/<世界GUID>` |

> 資料夾裡要有 `Level.sav` 與 `Players/` 才是對的那一個;玩過的世界通常幾十 MB 起跳
> (`du -sh <世界GUID>` 看一下最快),只有幾百 KB 的多半是沒玩過的空世界。

### 2. 兩邊都停下來

```bash
bash linux/stop.sh
```

舊伺服器也要關掉(共玩存檔 = 關閉遊戲)。**執行中複製會壞檔**,這是最常見的搬家失敗原因。

### 3. 整包複製

在專案根目錄執行(`-a` 會保留權限與時間戳):

```bash
cp -a /舊路徑/Pal/Saved/SaveGames/0/<世界GUID> backend/palworld-data/Pal/Saved/SaveGames/0/
```

從別台機器搬就用 `rsync`:

```bash
rsync -a --info=progress2 \
  user@舊主機:/舊路徑/Pal/Saved/SaveGames/0/<世界GUID> \
  backend/palworld-data/Pal/Saved/SaveGames/0/
```

⚠️ **`SaveGames/0/` 底下只放一個世界資料夾**;放兩個以上,伺服器可能載入到不是你要的那個。
也**不要**把舊伺服器的 `GameUserSettings.ini` 整檔複製過來(裡面夾帶舊 IP 與 RCON 設定)。

### 4. 修正擁有者,然後啟動

容器內以 uid/gid 1000 執行,複製進來的檔案要改成同一個擁有者,否則伺服器讀不到:

```bash
sudo chown -R 1000:1000 backend/palworld-data
bash linux/start.sh
```

開 <http://localhost> → 右上角按 🔄 重新載入 → 看得到大家的帕魯就成功了。

### 搬完卻是「全新世界」?

伺服器是靠 `Config/.../GameUserSettings.ini` 裡的 `DedicatedServerName=` 決定載入哪個世界,
不是看到資料夾就載入。把它改成你的 GUID 資料夾名再重啟即可。

**本機共玩存檔**還有一個特例:主機本人的角色綁在通用 ID,搬到專用伺服器後要用
[palworld-host-save-fix](https://github.com/xNul/palworld-host-save-fix) 修復
(其他成員直接登入就是原本的角色)。執行前先備份整個世界資料夾。

完整說明(含存檔結構圖與檢查清單)→
[Wiki:存檔搬家](https://github.com/daniel840711/palserver-tools/wiki/%E5%AD%98%E6%AA%94%E6%90%AC%E5%AE%B6)

## 沒有 Docker?用 SteamCMD 版

`linux/native/` 裡是 **SteamCMD 版** —— 不需要 Docker,用 SteamCMD 直接把伺服器裝在本機,
但**只有遊戲伺服器**,沒有查詢網站與自動排程。詳見 [docs/SteamCMD版.md](../docs/SteamCMD版.md)。

## 常見狀況

- **`permission denied`** —— 先 `chmod +x linux/*.sh`,或一律用 `bash linux/start.sh` 執行。
- **`docker: command not found`** —— 依 [官方文件](https://docs.docker.com/engine/install/) 安裝 Docker Engine。
- **`Cannot connect to the Docker daemon`** —— 引擎沒跑或沒權限:
  `sudo systemctl start docker`;權限問題用 `sudo usermod -aG docker "$USER"` 後重新登入。
  啟動腳本現在會先檢查並直接提示,不會再掉到看不懂的 socket 錯誤。
- **想改伺服器參數** —— 編輯專案根目錄的 `.env`,再跑 `bash linux/restart.sh`。
