# ⏰ 排程與廣播:`backend/config.json`

首次啟動自動產生(範本 `config.example.json`);改完執行 `windows\restart.bat`(或 `docker compose restart scheduler`)。

## `schedule.windows` 開服時段表(完整規則)

```json
"windows": [
  { "label": "weekday-night", "days": ["Mon","Tue","Wed","Thu","Fri"], "open": "19:00", "close": "23:30" },
  { "label": "weekend",       "days": ["Sat","Sun"],                   "open": "10:00", "close": "03:00" }
]
```

| 欄位 | 規則 |
|---|---|
| `label` | 純備註 |
| `days` | 套用的「開服當天」。`Mon`…`Sun` 或英文全名,大小寫不拘 |
| `open`/`close` | `"HH:MM"`,小時 0–23(**沒有 24:00**) |

- `close` ≤ `open` ⇒ 關服落在**隔天**(`Sat 10:00→03:00` = 開到週日凌晨 3 點);`days` 只列開服那天
- 多筆可重疊、同一天可拆多段(取聯集)
- **24 小時全開**:七天全列 + `"open":"00:00","close":"00:00"`
- 某天不開:不要把那天放進任何 `days`
- 時區依 `.env` 的 `TZ`

## 開/關服流程 `hooks`

到 `open` 執行 `onOpen`(啟動容器→等 30 秒→歡迎廣播);到 `close` 執行 `onClose`,倒數**結尾對齊** close:

```json
"announce": [
  { "at": 3600, "message": "伺服器將於 60 分鐘後關閉" },
  { "at": 600,  "message": "伺服器將於 10 分鐘後關閉" },
  { "at": 60,   "message": "1 分鐘後關閉,請做好下線準備" }
]
```

只要改這個陣列就能自訂提醒時間與文案;`at`=剩餘秒數。可用步驟型別:`startContainer / stopContainer / broadcast / wait / countdown / save / doexit / rcon / …`,像積木自由編排。

## 手動接管 API(需 `api.token`)

```bash
curl -H "Authorization: Bearer <token>" -X POST http://localhost:9000/api/open    # 立即開
curl -H "Authorization: Bearer <token>" -X POST http://localhost:9000/api/close   # 立即關(跑完整倒數流程)
curl -H "Authorization: Bearer <token>" -X POST http://localhost:9000/api/resume  # 交還自動排程
```
