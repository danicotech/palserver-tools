# 讀出「現在到底用哪個埠、密碼是什麼」並印成一塊 —— SteamCMD 版的伺服器設定
# 在 PalWorldSettings.ini(不是 .env),值都塞在同一行 OptionSettings 裡,
# 用 batch 很難拆,所以交給 PowerShell。
param(
  [string]$ServerDir,
  [int]$PanelPort = 9000
)

$ini = Join-Path $ServerDir "Pal\Saved\Config\WindowsServer\PalWorldSettings.ini"
$val = @{}
if (Test-Path $ini) {
  $line = (Get-Content $ini -Raw)
  foreach ($k in @("PublicPort", "ServerName", "ServerPassword", "AdminPassword", "RCONEnabled", "RESTAPIEnabled", "RCONPort", "RESTAPIPort")) {
    $m = [regex]::Match($line, $k + '=("([^"]*)"|[^,)\r\n]*)')
    if ($m.Success) { $val[$k] = if ($m.Groups[2].Success) { $m.Groups[2].Value } else { $m.Groups[1].Value } }
  }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $ip) { $ip = "你的IP" }

$port = if ($val["PublicPort"]) { $val["PublicPort"] } else { "8211" }
$pw = $val["ServerPassword"]
$admin = $val["AdminPassword"]

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  連線資訊" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ("  查詢網站   http://localhost:{0}   (區網 http://{1}:{0})" -f $PanelPort, $ip)
Write-Host ("  遊戲連線   {0}:{1}   (UDP,同一台可用 127.0.0.1:{1})" -f $ip, $port)
if ([string]::IsNullOrEmpty($pw)) {
  Write-Host "  進服密碼   (沒有設密碼,直接連)" -ForegroundColor Yellow
} else {
  Write-Host ("  進服密碼   {0}" -f $pw) -ForegroundColor Green
}
if ([string]::IsNullOrEmpty($admin)) {
  Write-Host "  管理密碼   (沒有設)" -ForegroundColor Yellow
} else {
  Write-Host ("  管理密碼   {0}" -f $admin) -ForegroundColor Green
}
if ($val["ServerName"]) { Write-Host ("  伺服器名稱 {0}" -f $val["ServerName"]) }
Write-Host "--------------------------------------------------"
if (Test-Path $ini) {
  Write-Host "  改密碼/埠/倍率就編輯這個檔,存檔後重開伺服器:"
  Write-Host ("    {0}" -f $ini) -ForegroundColor DarkGray
  if ($val["RESTAPIEnabled"] -ne "True") {
    Write-Host "  提示:RESTAPIEnabled=False —— 網站的「在線玩家」與即時位置會看不到," -ForegroundColor Yellow
    Write-Host "        建議在同一個檔把它改成 True 再重開伺服器。" -ForegroundColor Yellow
  }
} else {
  Write-Host "  設定檔還沒產生(伺服器第一次啟動後才會出現):"
  Write-Host ("    {0}" -f $ini) -ForegroundColor DarkGray
  Write-Host "  在那之前是官方預設值:無密碼、埠 8211。" -ForegroundColor Yellow
}
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
