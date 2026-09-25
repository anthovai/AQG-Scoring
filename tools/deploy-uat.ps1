# Deploy AQG UAT ขึ้นเซิร์ฟเวอร์ — รันจาก PowerShell บนเครื่อง dev
#
#   .\tools\deploy-uat.ps1                          # deploy ปกติ (อัปวีดีโอถ้ายังไม่มี/ขนาดต่าง)
#   .\tools\deploy-uat.ps1 -SkipVideo               # อัปเฉพาะโค้ด (เร็ว ใช้ตอนแก้โค้ด)
#   .\tools\deploy-uat.ps1 -Caddy                   # เซิร์ฟเวอร์ยังไม่มี reverse proxy
#   .\tools\deploy-uat.ps1 -ServerHost root@1.2.3.4 -Domain uat.example.com
#
# ใช้แค่ ssh / scp / tar ที่มีมากับ Windows (ไม่ต้องมี rsync หรือ git bash)
param(
  [string]$ServerHost = 'root@152.42.177.130',
  [string]$Domain     = 'aqg-uat.152.42.177.130.sslip.io',
  [string]$Dir        = '/opt/aqg',
  [switch]$SkipVideo,
  [switch]$Caddy
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$compose = if ($Caddy) { 'docker-compose.caddy.yml' } else { 'docker-compose.yml' }

function Step($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ── 0. ตรวจเครื่องมือ + การเชื่อมต่อ ─────────────────────────────────────────
foreach ($c in 'ssh','scp','tar') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Fail "ไม่พบคำสั่ง $c" }
}
Step "ทดสอบเชื่อมต่อ $ServerHost"
$probe = & ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $ServerHost 'echo CONNECTED; command -v docker >/dev/null && echo DOCKER_OK || echo DOCKER_MISSING' 2>&1
if ($LASTEXITCODE -ne 0 -or $probe -notcontains 'CONNECTED') {
  Write-Host $probe
  Fail "ต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจ ssh key หรือใช้ ssh-copy-id ก่อน"
}
if ($probe -contains 'DOCKER_MISSING') { Fail "เซิร์ฟเวอร์ยังไม่มี docker — ติดตั้งก่อน: curl -fsSL https://get.docker.com | sh" }
Write-Host "  เชื่อมต่อได้ + มี docker" -ForegroundColor Green

# ── 1. แพ็กโค้ด (ไม่เอาวีดีโอ/ผลจริง/log) ────────────────────────────────────
Step 'แพ็กโค้ด'
$tar = Join-Path $env:TEMP 'aqg-deploy.tar.gz'
if (Test-Path $tar) { Remove-Item $tar -Force }
& tar -czf $tar `
  --exclude='./results' --exclude='./logs' --exclude='./.git' `
  --exclude='./video' --exclude='./tools/shots' --exclude='./config/admin-key.txt' `
  --exclude='./node_modules' --exclude='*.pdf' `
  -C $root .
if ($LASTEXITCODE -ne 0) { Fail 'แพ็กโค้ดไม่สำเร็จ' }
Write-Host ("  {0:N1} MB" -f ((Get-Item $tar).Length / 1MB)) -ForegroundColor Green

# ── 2. ส่งขึ้นเซิร์ฟเวอร์ + แตกไฟล์ ──────────────────────────────────────────
Step "ส่งโค้ดไป $ServerHost`:$Dir"
& ssh $ServerHost "mkdir -p $Dir/video"
if ($LASTEXITCODE -ne 0) { Fail 'สร้างโฟลเดอร์บนเซิร์ฟเวอร์ไม่สำเร็จ' }
& scp -q $tar "$ServerHost`:$Dir/deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail 'ส่งไฟล์ไม่สำเร็จ' }
& ssh $ServerHost "cd $Dir && tar -xzf deploy.tar.gz && rm -f deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail 'แตกไฟล์บนเซิร์ฟเวอร์ไม่สำเร็จ' }

# ── 3. วีดีโอ (อัปเฉพาะไฟล์ที่ยังไม่มีหรือขนาดไม่ตรง) ─────────────────────────
if (-not $SkipVideo) {
  Step 'ตรวจ/อัปวีดีโอ'
  $remote = @{}
  (& ssh $ServerHost "ls -l $Dir/video 2>/dev/null | awk '{print `$9, `$5}'") | ForEach-Object {
    $p = $_ -split ' '
    if ($p.Count -ge 2 -and $p[0]) { $remote[$p[0]] = [int64]$p[1] }
  }
  foreach ($f in Get-ChildItem (Join-Path $root 'video') -Filter 'S0*-web.mp4') {
    if ($remote[$f.Name] -eq $f.Length) {
      Write-Host "  ข้าม $($f.Name) (มีแล้ว ขนาดตรงกัน)" -ForegroundColor DarkGray
      continue
    }
    Write-Host ("  อัป {0} ({1:N0} MB) — รอสักครู่" -f $f.Name, ($f.Length / 1MB))
    & scp -q $f.FullName "$ServerHost`:$Dir/video/"
    if ($LASTEXITCODE -ne 0) { Fail "อัป $($f.Name) ไม่สำเร็จ" }
  }
}

# ── 4. .env (admin key) ──────────────────────────────────────────────────────
Step 'เตรียม .env'
& ssh $ServerHost "cd $Dir && [ -f .env ] || { printf 'AQG_ADMIN_KEY=%s\n' `$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n') > .env; chmod 600 .env; }"

# ── 5. build + run ───────────────────────────────────────────────────────────
Step "build และ start ($compose)"
& ssh $ServerHost "cd $Dir && docker compose -f $compose up -d --build"
if ($LASTEXITCODE -ne 0) { Fail "docker compose ไม่สำเร็จ — ดู log: ssh $ServerHost 'cd $Dir && docker compose -f $compose logs --tail 60'" }

# ── 6. ตรวจผล ────────────────────────────────────────────────────────────────
Step 'ตรวจว่าเปิดใช้งานได้'
Start-Sleep -Seconds 8
$key = (& ssh $ServerHost "grep AQG_ADMIN_KEY $Dir/.env | cut -d= -f2").Trim()
$ok = $false
foreach ($try in 1..6) {
  try {
    $r = Invoke-WebRequest "https://$Domain/api/config" -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {
    Write-Host "  รอใบรับรอง HTTPS... ($try/6)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
  }
}

Write-Host ''
if ($ok) {
  Write-Host '══════════════════════════════════════════════' -ForegroundColor Green
  Write-Host " ใช้งานได้แล้ว" -ForegroundColor Green
  Write-Host "   เกม      : https://$Domain"
  Write-Host "   หลังบ้าน : https://$Domain/admin.html"
  Write-Host "   admin key: $key"
  Write-Host '══════════════════════════════════════════════' -ForegroundColor Green
} else {
  Write-Host "ยังเรียกผ่าน https ไม่ได้" -ForegroundColor Yellow
  Write-Host "  ดู log   : ssh $ServerHost `"cd $Dir && docker compose -f $compose logs --tail 60`""
  Write-Host "  ถ้าเซิร์ฟเวอร์ไม่มี reverse proxy ให้ลองใหม่ด้วย: .\tools\deploy-uat.ps1 -Caddy -SkipVideo"
}
