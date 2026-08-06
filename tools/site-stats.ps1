<#
.SYNOPSIS
    看查詢網站的瀏覽統計。純讀本機的 logs/nginx/hits.log,不連任何外部服務。

.DESCRIPTION
    資料來源是 frontend/nginx.conf 裡的 hits.log —— 只記兩種事件:
      _enter   進站(有人打開網站)
      <分頁名> 前端切到某個分頁(dashboard / breeding / paldex …)

    要先重建 panel 容器讓設定生效:
      docker compose up -d --build panel

.PARAMETER Days
    只看最近幾天。預設 0 = 全部。

.EXAMPLE
    powershell -File tools\site-stats.ps1
    powershell -File tools\site-stats.ps1 -Days 7
#>
[CmdletBinding()]
param(
    [int]$Days = 0,
    [string]$LogPath = (Join-Path $PSScriptRoot "..\logs\nginx\hits.log")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogPath)) {
    Write-Host "找不到 $LogPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "統計還沒開始跑。要先重建 panel 容器讓 nginx 設定生效:" -ForegroundColor Yellow
    Write-Host "  docker compose up -d --build panel"
    exit 1
}

# 欄位: 時間 \t 分頁 \t 訪客IP \t 國家 \t UA
$rows = Get-Content -LiteralPath $LogPath | ForEach-Object {
    $f = $_ -split "`t"
    if ($f.Count -lt 5) { return }
    $ts = $null
    if (-not [datetime]::TryParse($f[0], [ref]$ts)) { return }
    [pscustomobject]@{
        Time    = $ts
        Day     = $ts.ToString("yyyy-MM-dd")
        Page    = $f[1]
        IP      = $f[2]
        Country = if ($f[3] -and $f[3] -ne "-") { $f[3] } else { "??" }
        Mobile  = $f[4] -match "iPhone|Android|Mobile|iPad"
    }
}

if ($Days -gt 0) {
    $cut = (Get-Date).AddDays(-$Days)
    $rows = $rows | Where-Object { $_.Time -ge $cut }
}

if (-not $rows) {
    Write-Host "這個區間沒有任何紀錄。" -ForegroundColor Yellow
    exit 0
}

$enters = @($rows | Where-Object Page -eq "_enter")
$views  = @($rows | Where-Object Page -ne "_enter")
$first  = ($rows | Sort-Object Time | Select-Object -First 1).Time
$last   = ($rows | Sort-Object Time | Select-Object -Last 1).Time
$span   = [math]::Max(1.0, ($last - $first).TotalDays)

function Write-Section([string]$title) {
    Write-Host ""
    Write-Host "── $title " -NoNewline -ForegroundColor Cyan
    Write-Host ("─" * [math]::Max(0, 46 - $title.Length)) -ForegroundColor DarkCyan
}

function Write-Bar($name, $count, $max, $width = 28) {
    $bar = "█" * [math]::Max(0, [int]([math]::Round($count / [math]::Max(1, $max) * $width)))
    "{0,-14} {1,6}  {2}" -f $name, $count, $bar
}

Write-Section "總覽"
"期間           {0:yyyy-MM-dd HH:mm} → {1:yyyy-MM-dd HH:mm}  ({2:N1} 天)" -f $first, $last, $span
"進站次數       {0}" -f $enters.Count
"不重複訪客     {0}   (以 IP 計,IPv6 會輪替所以偏高)" -f (@($rows.IP | Sort-Object -Unique)).Count
"分頁瀏覽次數   {0}" -f $views.Count
"平均每日進站   {0:N1}" -f ($enters.Count / $span)
"手機比例       {0:P0}" -f $(if ($rows.Count) { (@($rows | Where-Object Mobile).Count / $rows.Count) } else { 0 })

Write-Section "每日進站"
$byDay = $enters | Group-Object Day | Sort-Object Name
if ($byDay) {
    $mx = ($byDay | Measure-Object Count -Maximum).Maximum
    $byDay | ForEach-Object { Write-Bar $_.Name $_.Count $mx }
}

Write-Section "分頁人氣"
$byPage = $views | Group-Object Page | Sort-Object Count -Descending
if ($byPage) {
    $mx = ($byPage | Measure-Object Count -Maximum).Maximum
    $byPage | ForEach-Object { Write-Bar $_.Name $_.Count $mx }
} else {
    "(還沒有分頁事件 —— 前端要重建過才會送信標)"
}

Write-Section "國家"
$byCountry = $rows | Group-Object Country | Sort-Object Count -Descending | Select-Object -First 12
if ($byCountry) {
    $mx = ($byCountry | Measure-Object Count -Maximum).Maximum
    $byCountry | ForEach-Object { Write-Bar $_.Name $_.Count $mx }
}

Write-Section "回訪(同一 IP 進站多次)"
$repeat = $enters | Group-Object IP | Where-Object Count -gt 1 | Sort-Object Count -Descending
"有回訪的訪客   {0} / {1}" -f @($repeat).Count, (@($enters.IP | Sort-Object -Unique)).Count
Write-Host ""
