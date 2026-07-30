# 首次啟動自動設定(Windows):
#   沒有 .env / backend\config.json 時自動產生 —— 隨機密碼 + token,
#   並讓 config.json 的 rcon.password 與 .env 的 ADMIN_PASSWORD 保持一致。
# 已存在的檔案一律不動,重複執行安全。
# 注意:全部用 UTF-8(無 BOM)讀寫 —— PowerShell 5.1 預設 ANSI 會把中文設定檔讀成亂碼,
#       而帶 BOM 的 .env 會讓 docker compose 讀不到第一個變數。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-RandomText([int]$len) {
  $chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
  -join (1..$len | ForEach-Object { $chars | Get-Random })
}
function Read-Utf8([string]$path) { [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) }
function Write-Utf8([string]$path, [string]$text) { [System.IO.File]::WriteAllText($path, $text, $utf8NoBom) }

# ---- .env(所有伺服器參數都在這;從 .example.env 複製,並隨機生成兩組密碼)----
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) {
  $content = Read-Utf8 (Join-Path $root ".example.env")
  $content = $content.Replace("ADMIN_PASSWORD=CHANGE_ME_ADMIN", "ADMIN_PASSWORD=" + (New-RandomText 14))
  $content = $content.Replace("SERVER_PASSWORD=CHANGE_ME_JOIN", "SERVER_PASSWORD=" + (New-RandomText 8))
  Write-Utf8 $envPath $content
  Write-Host "已從 .example.env 產生 .env(兩組密碼已隨機生成;所有伺服器參數都可在 .env 調整)" -ForegroundColor Green
}

# 讀 .env
$envMap = @{}
[System.IO.File]::ReadAllLines($envPath, [System.Text.Encoding]::UTF8) | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_]+)\s*=\s*(.*)$') { $envMap[$matches[1]] = $matches[2] }
}

# ---- backend\config.json(從範本複製 + 同步密碼/隨機 token)----
$cfgPath = Join-Path $root "backend\config.json"
if (-not (Test-Path $cfgPath)) {
  $cfg = (Read-Utf8 (Join-Path $root "backend\config.example.json")) | ConvertFrom-Json
  $cfg.rcon.password = $envMap["ADMIN_PASSWORD"]
  $cfg.api.token = New-RandomText 32
  Write-Utf8 $cfgPath ($cfg | ConvertTo-Json -Depth 20)
  Write-Host "已產生 backend\config.json(密碼已與 .env 同步、API token 已隨機生成)" -ForegroundColor Green
}

Write-Host ""
Write-Host "================ 你的伺服器密碼(保存好!) ================" -ForegroundColor Cyan
Write-Host ("  管理密碼 ADMIN_PASSWORD : " + $envMap["ADMIN_PASSWORD"])
Write-Host ("  進服密碼 SERVER_PASSWORD: " + $envMap["SERVER_PASSWORD"])
Write-Host "  (之後想改:編輯專案根目錄的 .env,再雙擊「restart.bat」)"
Write-Host "=============================================================" -ForegroundColor Cyan
