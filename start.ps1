# เริ่มระบบ AQG สำหรับใช้งานจริง
#   .\start.ps1                 # เปิดแบบบังคับใช้รหัสเข้าเล่น (แนะนำสำหรับเก็บข้อมูลจริง)
#   .\start.ps1 -NoCode         # เปิดให้ใครก็เล่นได้ (สาธิต/ทดลอง)
#   .\start.ps1 -Port 8080
#
# admin key อ่านจาก config\admin-key.txt — ถ้ายังไม่มี สคริปต์จะสุ่มให้ครั้งแรก
# แล้วใช้คีย์เดิมทุกครั้ง (ไฟล์นี้ไม่ขึ้น GitHub)
param(
  [int]$Port = 5190,
  [switch]$NoCode
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$keyFile = Join-Path $PSScriptRoot 'config\admin-key.txt'
if (-not (Test-Path (Split-Path $keyFile))) { New-Item -ItemType Directory -Force (Split-Path $keyFile) | Out-Null }
if (-not (Test-Path $keyFile)) {
  # ใช้ API ที่มีใน Windows PowerShell 5.1 (.NET Framework)
  $bytes = New-Object byte[] 18
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($bytes)
  $rng.Dispose()
  (($bytes | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Content $keyFile -Encoding ascii -NoNewline
  Write-Host "สร้าง admin key ใหม่ไว้ที่ config\admin-key.txt" -ForegroundColor Yellow
}
$env:AQG_ADMIN_KEY = (Get-Content $keyFile -Raw).Trim()
$env:AQG_REQUIRE_CODE = if ($NoCode) { '0' } else { '1' }

# ที่อยู่สำหรับเครื่องอื่น/มือถือในวง LAN เดียวกัน
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host '──────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host " เครื่องนี้      : http://localhost:$Port"
foreach ($ip in $ips) { Write-Host " ในวง LAN       : http://${ip}:$Port" -ForegroundColor Green }
Write-Host " หลังบ้าน       : http://localhost:$Port/admin.html"
Write-Host " admin key      : $($env:AQG_ADMIN_KEY)"
Write-Host " ต้องใช้รหัสเล่น : $(if ($NoCode) { 'ไม่ต้อง (โหมดสาธิต)' } else { 'ต้องใช้ — แก้รายชื่อที่ config\access-codes.json' })"
Write-Host '──────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'ถ้าเครื่องอื่นเข้าไม่ได้ ให้เปิด firewall ครั้งเดียว (รันเป็น Administrator):' -ForegroundColor DarkGray
Write-Host "  New-NetFirewallRule -DisplayName 'AQG' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow" -ForegroundColor DarkGray
Write-Host ''

node server.js $Port
