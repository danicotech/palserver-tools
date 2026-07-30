# palsave — 解析存檔取得玩家帕魯資料

RCON / REST API **拿不到帕魯資料**；帕魯（種類、等級、個體值、擁有者…）存在 `Level.sav` 裡，
必須解析存檔。此工具負責這件事。

## 能取得什麼
**每隻帕魯**：種類（繁中/英名）、圖鑑編號、屬性、等級、經驗、性別、星級、靈魂強化（HP/攻/防/工作）、
個體值（HP/攻擊/防禦）、目前 HP、好感度、飽食度、食物效果、工作適性、α、Lucky、暱稱、
已裝備主動技能、已習得主動技能、被動技能（技能/被動/屬性/適性皆繁中）。

**每位玩家**：名稱、UID、等級、經驗、HP、護盾、飽食度、飢餓/健康狀態、未分配能力點、
已配點（HP/耐力/攻擊/重量/捕獲/工作速度）、聲音 ID、最後座標，以及其擁有的帕魯清單。

## 安裝
需要 Python 3.10+。
```bash
pip install -r requirements.txt
```
- `pyooz`：開源 Oodle 解壓，用來解新版 **PlM** 壓縮格式（Palworld v0.6+/v1.0），不需專有 DLL。
- `palworld-save-tools`：GVAS 存檔解析。

## 用法
```bash
# 全部玩家 → 輸出 JSON（預設 <save>.pals.json）
python extract_pals.py <Level.sav>

# 指定輸出、只看單一玩家（名稱或 UID，部分比對）
python extract_pals.py <Level.sav> -o pals.json --player 超濃狗
```

Docker 部署下，存檔在 `palworld-data/Pal/Saved/SaveGames/0/<世界ID>/Level.sav`。
**建議先複製一份再解析**，避免與執行中的伺服器同時讀寫：
```bash
cp palworld-data/Pal/Saved/SaveGames/0/<世界ID>/Level.sav /tmp/Level.sav
python extract_pals.py /tmp/Level.sav -o pals.json
```

## 輸出格式
```json
{
  "total_pals": 3830,
  "orphan_pals": 0,
  "players": [
    { "name": "超濃狗起司", "uid": "a9998f41-0000-...", "level": 30, "exp": 275974,
      "hp": 1, "shield_hp": 540, "stomach": 0, "hunger": "Starvation", "health": "Severe",
      "unused_status_point": 11,
      "status_points": { "hp": 0, "stamina": 0, "attack": 0, "weight": 18, "capture": 0, "workspeed": 0 },
      "voice_id": 5, "location": { "x": -34789, "y": 120772, "z": 15495 },
      "pal_count": 38,
      "pals": [
        { "species": "CowPal", "name_zh": "波霸牛", "name_en": "Mozzarina",
          "paldeck": "29", "elements": ["無"], "level": 80, "exp": 144829235,
          "gender": "Male", "rank": 5,
          "souls": { "hp": 20, "attack": 20, "defense": 20, "craftspeed": 20 },
          "iv_hp": 100, "iv_attack": 100, "iv_defense": 100,
          "hp": 16103, "friendship": 239060, "stomach": 77, "food_buff": "",
          "work": { "牧場": 1 }, "is_alpha": true, "is_lucky": false, "nickname": "...",
          "active_skills": ["晶鑽之雨", "雷霆颶風", "光擊陣"],
          "mastered_skills": ["能量射擊", "雷霆颶風", "晶鑽之雨", "光擊陣"],
          "passives": ["卓絕技藝", "吸血鬼", "工匠精神", "社畜"] }
      ] }
  ]
}
```

## 運作原理與相容性
1. `Level.sav` 為新版 **PlM(Oodle)** 壓縮 → 用 `pyooz` 解壓成 GVAS。
2. 用 `palworld-save-tools` 解析 `CharacterSaveParameterMap`（玩家與帕魯都在此），
   依 `OwnerPlayerUId` 把帕魯歸到各玩家。
3. 腳本內以 **runtime monkeypatch** 容忍 v1.0 存檔中套件尚未支援的新欄位/型別
   （角色尾端多餘位元組、`SetProperty` 等），故可直接對乾淨的 `pip install` 執行。

## 名稱對照
內部代號 → `{en, zh}` 對照，`zh` 已是**繁體**（來源 KrisCris/Palworld-Pal-Editor 的 zh-CN，
建置時用 OpenCC `s2tw` 轉繁；**執行期不需 OpenCC**，繁體已烘進 JSON）：
- `pal_names.json`：帕魯種類
- `skill_names.json`：主動技能（`EPalWazaID::*`）
- `passive_names.json`：被動技能

規則與備註：
- 找不到的代號（少數最新帕魯/技能、人形 NPC、各帕魯專屬 Unique 招式）會退回「美化後的英文代號」。
- 攻擊個體值取自 `Talent_Shot`（`Talent_Melee` 在現版固定為 0）。
- 要補新資料或微調用字，直接編輯對應的 `*_names.json` 即可（不需重建對照）。
- 重建對照（更新版本時）：`pip install opencc` 後，用 KrisCris/Palworld-Pal-Editor 的
  `pal_data.json` / `pal_attacks.json` / `pal_passives.json`，取 `I18n` 的 en 與 zh-CN，
  zh-CN 經 `opencc.OpenCC('s2tw').convert()` 轉繁後寫回。

## 已知限制
- 資料為**最後一次存檔**的狀態（伺服器每 30 秒自動存檔，或執行 Save）。
- α/BOSS_ 前綴的帕魯會對應到其基礎種類名並標記 `is_alpha`。
