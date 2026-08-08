# PalWorldSettings.ini 參數說明

伺服器的所有遊戲設定都在這個檔案裡:

```
<伺服器資料夾>\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini    (Windows)
<伺服器資料夾>/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini      (Linux / Docker)
```

格式只有一行,全部設定擠在 `OptionSettings=(...)` 裡用逗號分隔:

```ini
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,ExpRate=1.000000,...,AdminPassword="654321")
```

改完**要重開伺服器**才生效(關掉 start-all 視窗再開即可)。

> 參數表以本專案的 schema [`frontend/packages/shared/src/options.ts`](../frontend/packages/shared/src/options.ts) 為準,共 118 個。
> 官方文件站的參數頁長年不完整(1.0 版的 Performances 分類只列 7 個鍵),所以不以它為唯一依據。

---

## 先看這裡:三個最容易踩的坑

### 1. `WorldOption.sav` 會蓋掉整份 ini

從單機(含單機多人連線)搬過來的存檔,世界資料夾裡會有 `WorldOption.sav`。
**它的優先權高於 `PalWorldSettings.ini`** —— 裡面同樣有 `AdminPassword`、
`RESTAPIEnabled`、`RCONEnabled`、`ExpRate` 這些鍵,而單機世界的管理密碼是空的、
REST/RCON 是關的。

症狀是伺服器直接回:

```
this server does not have an AdminPassword set
```

**你怎麼改 ini 都沒用**,因為伺服器根本沒在看 ini。把它改名或刪掉(先備份):

```
<世界資料夾>\WorldOption.sav  →  WorldOption.sav.disabled
```

`backend/tools/migrate_coop_save.py` 在搬遷時會自動處理這一步。

### 2. `PublicPort` 不是實際的監聽埠

它**只影響社群伺服器列表上顯示的埠**。改它不會改變伺服器實際在聽哪個埠 ——
那要用啟動參數(`-port=`)。要換連線埠時別只改這裡。

### 3. 官方預設關閉 REST 與 RCON

`DefaultPalWorldSettings.ini` 裡 `RESTAPIEnabled=False`、`RCONEnabled=False`。
兩個都關著的話,面板的在線人數、即時座標、廣播、踢人、優雅關服**全部失效**。

`backend/tools/ensure_server_ini.py` 每次啟動會強制轉成 `True`,所以用本專案
啟動時不必手動處理;直接跑官方 `PalServer.exe` 的話要自己開。

---

## 伺服器基本

| 參數 | 預設 | 說明 |
|---|---|---|
| `ServerName` | `"Default Palworld Server"` | 伺服器名稱,顯示在社群列表 |
| `ServerDescription` | `""` | 伺服器說明文字 |
| `ServerPassword` | `""` | 進服密碼,空 = 任何人可進 |
| `AdminPassword` | `""` | **管理密碼**。REST 與 RCON 都用它認證,空的話面板一律 401 |
| `ServerPlayerMaxNum` | `32` | 最大同時在線人數(1–99) |
| `CoopPlayerMaxNum` | `4` | 單機多人連線人數(1–8),專用伺服器不使用 |
| `PublicIP` | `""` | 社群列表顯示的 IP |
| `PublicPort` | `8211` | 社群列表顯示的埠 —— **不是實際監聽埠** |
| `bIsMultiplay` | `false` | 單機的多人旗標,專用伺服器無意義 |
| `bShowPlayerList` | `false` | 允許玩家查看在線名單 |
| `bIsShowJoinLeftMessage` | `true` | 顯示玩家進出訊息 |
| `bUseAuth` | `true` | Steam 驗證,關掉會允許未驗證的客戶端連線 |
| `Region` | `""` | 社群列表的地區標籤 |
| `bAllowClientMod` | `true` | 允許客戶端模組 |
| `bEnableVoiceChat` | `false` | 語音聊天 |
| `ChatPostLimitPerMinute` | `10` | 每分鐘聊天訊息上限(防洗頻) |
| `CrossplayPlatforms` | — | 允許跨平台連線的平台清單 |
| `BanListURL` | 官方網址 | 封鎖名單來源 |

## 遠端管理(面板功能全靠這兩組)

| 參數 | 預設 | 說明 |
|---|---|---|
| `RESTAPIEnabled` | `False` | 關掉就沒有在線人數、即時座標、踢人 |
| `RESTAPIPort` | `8212` | REST 監聽埠 |
| `RCONEnabled` | `False` | 關掉就沒有廣播、優雅關服、指令台 |
| `RCONPort` | `25575` | RCON 監聽埠 |

同一台機器跑兩個伺服器時,這兩個埠和 `PublicPort` 都要錯開,否則面板會連到
另一台去,錯誤訊息會誤導成「密碼錯誤」。

## 存檔與效能

| 參數 | 預設 | 說明 |
|---|---|---|
| `AutoSaveSpan` | `30` | **自動存檔間隔(秒)**。拉長減少存檔卡頓,但當機時損失更多進度 |
| `bIsUseBackupSaveData` | `true` | 自動備份存檔 |
| `LogFormatType` | `"Text"` | 日誌格式 |
| `MaxGuildsPerFrame` | `10` | 每幀處理的公會數 |
| `ItemContainerForceMarkDirtyInterval` | — | 容器同步間隔,調大省效能 |
| `PlayerDataPalStorageUpdateCheckTickInterval` | — | 帕魯箱檢查間隔 |
| `ServerReplicatePawnCullDistance` | — | 角色同步距離,調小省頻寬 |
| `BuildingNameDisplayCacheTTLSeconds` | — | 建築名稱快取秒數 |
| `AutoTransferMasterThresholdDays` | `14` | 公會會長長期未上線後自動轉移的天數 |
| `AutoTransferMasterCheckIntervalSeconds` | — | 上面的檢查間隔 |

> 面板上的資料多久更新一次,和 `AutoSaveSpan` 只有部分關係:
> 在線人數與即時座標走 REST(即時),玩家/帕魯資料才是解析存檔而來。

## 難度與倍率:玩家

| 參數 | 預設 | 說明 |
|---|---|---|
| `Difficulty` | `None` | 難度預設組。`None` = 使用下面的自訂值 |
| `ExpRate` | `1.0` | 經驗值倍率 |
| `PlayerDamageRateAttack` | `1.0` | 玩家打出的傷害 |
| `PlayerDamageRateDefense` | `1.0` | 玩家承受的傷害 |
| `PlayerStomachDecreaceRate` | `1.0` | 飢餓下降速度 |
| `PlayerStaminaDecreaceRate` | `1.0` | 耐力消耗速度 |
| `PlayerAutoHPRegeneRate` | `1.0` | 自動回血速度 |
| `PlayerAutoHpRegeneRateInSleep` | `1.0` | 睡眠時回血速度 |
| `ItemWeightRate` | `1.0` | 負重倍率(調低 = 背得更多) |
| `EquipmentDurabilityDamageRate` | `1.0` | 裝備耐久消耗 |
| `bAllowEnhanceStat_Health` | `true` | 允許強化血量 |
| `bAllowEnhanceStat_Attack` | `true` | 允許強化攻擊 |
| `bAllowEnhanceStat_Stamina` | `true` | 允許強化耐力 |
| `bAllowEnhanceStat_Weight` | `true` | 允許強化負重 |
| `bAllowEnhanceStat_WorkSpeed` | `true` | 允許強化工作速度 |

## 難度與倍率:帕魯

| 參數 | 預設 | 說明 |
|---|---|---|
| `PalCaptureRate` | `1.0` | 捕捉成功率 |
| `PalSpawnNumRate` | `1.0` | 野生帕魯生成數量 |
| `PalDamageRateAttack` | `1.0` | 帕魯打出的傷害 |
| `PalDamageRateDefense` | `1.0` | 帕魯承受的傷害 |
| `PalStomachDecreaceRate` | `1.0` | 帕魯飢餓速度 |
| `PalStaminaDecreaceRate` | `1.0` | 帕魯耐力消耗 |
| `PalAutoHPRegeneRate` | `1.0` | 帕魯自動回血 |
| `PalAutoHpRegeneRateInSleep` | `1.0` | 帕魯睡眠回血 |
| `PalEggDefaultHatchingTime` | `72` | 孵蛋時數(設 0 = 立即孵化) |
| `WorkSpeedRate` | `1.0` | 據點工作速度 |
| `MonsterFarmActionSpeedRate` | `1.0` | 牧場產出速度 |
| `bPalLost` | `false` | 帕魯死亡是否永久消失 |
| `EnablePredatorBossPal` | `true` | 掠食者首領帕魯 |
| `bAllowGlobalPalboxExport` | `true` | 允許把帕魯匯出到其他伺服器 |
| `bAllowGlobalPalboxImport` | `false` | 允許從其他伺服器匯入帕魯 |

## 公會與據點

| 參數 | 預設 | 說明 |
|---|---|---|
| `GuildPlayerMaxNum` | `20` | 公會人數上限 |
| `BaseCampMaxNum` | `128` | **全伺服器**據點總數上限(效能關鍵) |
| `BaseCampMaxNumInGuild` | `4` | 每個公會的據點數 |
| `BaseCampWorkerMaxNum` | `15` | 每個據點的帕魯工作數 |
| `bAutoResetGuildNoOnlinePlayers` | `false` | 全員長期未上線就解散公會 |
| `AutoResetGuildTimeNoOnlinePlayers` | `72` | 上面的判定時數 |
| `GuildRejoinCooldownMinutes` | `0` | 退出公會後重新加入的冷卻(分鐘) |
| `bEnableDefenseOtherGuildPlayer` | `false` | 據點防禦設施會攻擊其他公會玩家 |
| `bCanPickupOtherGuildDeathPenaltyDrop` | `false` | 可撿其他公會玩家的死亡掉落 |
| `bInvisibleOtherGuildBaseCampAreaFX` | `false` | 隱藏其他公會據點的範圍特效 |
| `bDisplayPvPItemNumOnWorldMap_BaseCamp` | `false` | 地圖顯示據點的 PvP 掉落數 |

## 建築

| 參數 | 預設 | 說明 |
|---|---|---|
| `BuildObjectHpRate` | `1.0` | 建築耐久倍率 |
| `BuildObjectDamageRate` | `1.0` | 建築受損倍率 |
| `BuildObjectDeteriorationDamageRate` | `1.0` | 自然劣化速度(設 `0` = 建築不會壞) |
| `MaxBuildingLimitNum` | `0` | 建築數量上限,`0` = 無限 |
| `bBuildAreaLimit` | `false` | 建築範圍限制 |
| `bEnableBuildingPlayerUIdDisplay` | `false` | 顯示建築是誰蓋的 |

## 掉落與採集

| 參數 | 預設 | 說明 |
|---|---|---|
| `CollectionDropRate` | `1.0` | 採集產物倍率(礦石、木頭等) |
| `CollectionObjectHpRate` | `1.0` | 採集點耐久 |
| `CollectionObjectRespawnSpeedRate` | `1.0` | 採集點重生速度 |
| `EnemyDropItemRate` | `1.0` | 敵人掉落倍率 |
| `DropItemMaxNum` | `3000` | 地上掉落物上限(效能關鍵,重載伺服器建議 2000–2500) |
| `PhysicsActiveDropItemMaxNum` | `-1` | 有物理效果的掉落物上限,`-1` = 不限 |
| `DropItemAliveMaxHours` | `1.0` | 掉落物存在時數 |
| `ItemCorruptionMultiplier` | `1.0` | 食物腐壞速度 |
| `SupplyDropSpan` | `180` | 空投間隔(分鐘) |
| `DenyTechnologyList` | `""` | 禁用的科技清單 |
| `DropItemMaxNum_UNKO` | `100` | 糞便掉落上限 |
| `bActiveUNKO` | `false` | 啟用糞便機制 |

## 世界與環境

| 參數 | 預設 | 說明 |
|---|---|---|
| `DayTimeSpeedRate` | `1.0` | 白天流逝速度(調小 = 白天更長) |
| `NightTimeSpeedRate` | `1.0` | 夜晚流逝速度 |
| `bEnableInvaderEnemy` | `true` | 據點襲擊事件 |
| `bEnableFastTravel` | `true` | 快速旅行 |
| `bIsStartLocationSelectByMap` | `false` | 可在地圖上自選出生點 |
| `bExistPlayerAfterLogout` | `false` | 登出後角色留在世界(可能被攻擊) |
| `bEnableNonLoginPenalty` | `true` | 長期未登入的懲罰 |
| `bEnableAimAssistPad` | `true` | 手把瞄準輔助 |
| `bEnableAimAssistKeyboard` | `false` | 鍵盤瞄準輔助 |
| `RandomizerType` | `None` | 帕魯隨機化模式 |
| `RandomizerSeed` | `""` | 隨機化種子 |
| `bIsRandomizerPalLevelRandom` | `false` | 隨機化時等級也隨機 |

## 死亡懲罰與 PvP

| 參數 | 預設 | 說明 |
|---|---|---|
| `DeathPenalty` | `Item` | `None` 不掉 / `Item` 掉道具 / `ItemAndEquipment` 連裝備 / `All` 連帕魯 |
| `bHardcore` | `false` | 硬核模式(角色永久死亡) |
| `bCharacterRecreateInHardcore` | `false` | 硬核死亡後可重建角色 |
| `BlockRespawnTime` | `5` | 復活等待秒數 |
| `RespawnPenaltyTimeScale` | `2` | 連續死亡的復活時間倍率 |
| `RespawnPenaltyDurationThreshold` | — | 連續死亡的判定間隔 |
| `bIsPvP` | `false` | PvP 模式 |
| `bEnablePlayerToPlayerDamage` | `false` | 玩家互相傷害 |
| `bEnableFriendlyFire` | `false` | 同公會友軍傷害 |
| `bAdditionalDropItemWhenPlayerKillingInPvPMode` | `false` | PvP 擊殺額外掉落 |
| `AdditionalDropItemWhenPlayerKillingInPvPMode` | — | 額外掉落的道具 |
| `AdditionalDropItemNumWhenPlayerKillingInPvPMode` | — | 額外掉落的數量 |
| `bDisplayPvPItemNumOnWorldMap_Player` | `false` | 地圖顯示玩家的 PvP 掉落數 |

## 語音

| 參數 | 預設 | 說明 |
|---|---|---|
| `VoiceChatMaxVolumeDistance` | — | 語音滿音量的距離 |
| `VoiceChatZeroVolumeDistance` | — | 語音靜音的距離 |

---

## 改設定的三種方式

**① 直接編輯 ini** —— 改完重開伺服器。注意整份設定在同一行,不要不小心把
結尾的 `)` 刪掉:少了它伺服器會忽略整行、全部退回預設值(包含管理密碼變空)。

**② 用面板** —— `.env` 只在**全新安裝**時提供初始的兩組密碼,之後改 `.env`
不會同步到 ini。SteamCMD 版沒有「從 .env 產生 ini」的機制,那是 Docker 版的行為。

**③ 讓工具維持一致** —— 每次啟動時 `ensure_server_ini.py` 會:

- 強制 `RESTAPIEnabled=True`、`RCONEnabled=True`
- `AdminPassword` 是空的就填上面板用的那組
- 兩邊密碼不一致時,把 `backend/config.json` 的 `rcon.password` 對齊伺服器
- 整行被截斷(沒有結尾 `)`)時自動補回,並從官方範本補齊缺掉的鍵
- 動手前先留 `.bak`

## 相關文件

- [SteamCMD 版說明](SteamCMD版.md)
- 參數 schema:[`frontend/packages/shared/src/options.ts`](../frontend/packages/shared/src/options.ts)
- 官方文件:<https://docs.palworldgame.com/settings-and-operation/configuration>
  (參數表不完整,建議以實際的 `DefaultPalWorldSettings.ini` 為準)
