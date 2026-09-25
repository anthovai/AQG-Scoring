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
# tar.exe รับพาธภาษาไทยเป็น argument ไม่ได้ (จะขึ้น could not chdir)
# จึงย้าย working directory ด้วย PowerShell แล้วใช้ "." ล้วนๆ
Push-Location $root
try {
  & tar -czf $tar `
    --exclude=./results --exclude=./logs --exclude=./.git `
    --exclude=./video --exclude=./tools/shots --exclude=./config/admin-key.txt `
    --exclude=./node_modules --exclude=*.pdf `
    .
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tar)) { Fail 'แพ็กโค้ดไม่สำเร็จ' }
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
    # scp ก็รับพาธไทยไม่ได้เหมือนกัน — ย้าย cwd แล้วใช้ชื่อไฟล์ล้วน
    Push-Location (Join-Path $root 'video')
    try { & scp -q $f.Name "$ServerHost`:$Dir/video/" } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Fail "อัป $($f.Name) ไม่สำเร็จ" }
  }
}

# ── 4. ตรวจการตั้งค่า reverse proxy บนเซิร์ฟเวอร์ ────────────────────────────
Step 'เตรียม .env + ตรวจ reverse proxy'
& ssh $ServerHost "cd $Dir && [ -f .env ] || { printf 'AQG_ADMIN_KEY=%s
' `$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' 
') > .env; chmod 600 .env; }"

if (-not $Caddy) {
  $info = & ssh $ServerHost "sh $Dir/tools/detect-proxy.sh" 2>&1
  $val = { param($k) ($info | Where-Object { $_ -like "$k=*" } | Select-Object -First 1) -replace "^$k=", '' }

  $refLabels = $info | Where-Object { $_ -like 'RLBL=*' }
  $net = ($info | Where-Object { $_ -like 'RNET=*' } | Select-Object -First 1) -replace '^RNET=', ''
  if (-not $net) {
    $net = ($info | Where-Object { $_ -like 'PNET=*' } |
            ForEach-Object { $_ -replace '^PNET=', '' } |
            Where-Object { $_ -notin @('bridge','host','none') } | Select-Object -First 1)
  }

  # certresolver / entrypoints: ดูจากบริการที่ใช้งานได้จริงก่อน แล้วค่อยดูจาก traefik
  $resolver = ($refLabels | Where-Object { $_ -match 'certresolver=(.+)$' } |
               ForEach-Object { $Matches[1] } | Select-Object -First 1)
  if (-not $resolver) {
    $resolver = ($info | Where-Object { $_ -match 'certificatesresolvers\.([A-Za-z0-9_-]+)\.' } |
                 ForEach-Object { $Matches[1] } | Select-Object -First 1)
  }
  $epHttps = ($refLabels | Where-Object { $_ -match 'entrypoints=(.+)$' } |
              ForEach-Object { ($Matches[1] -split ',')[0] } | Select-Object -First 1)
  $epHttp = $null
  if (-not $epHttps) {
    $epHttps = ($info | Where-Object { $_ -match 'entrypoints\.([A-Za-z0-9_-]+)\.address=:443' } |
                ForEach-Object { $Matches[1] } | Select-Object -First 1)
  }
  $epHttp = ($info | Where-Object { $_ -match 'entrypoints\.([A-Za-z0-9_-]+)\.address=:80' } |
             ForEach-Object { $Matches[1] } | Select-Object -First 1)

  if (-not $net) {
    Write-Host '  ไม่พบ reverse proxy บนเซิร์ฟเวอร์' -ForegroundColor Yellow
    Write-Host '  ให้รันใหม่ด้วย:  .	ools\deploy-uat.ps1 -Caddy -SkipVideo' -ForegroundColor Yellow
    Fail 'หยุดไว้ก่อน เพื่อไม่ให้ตั้งค่าผิด'
  }

  if (-not $resolver) { $resolver = 'letsencrypt' }
  if (-not $epHttps)  { $epHttps  = 'websecure' }
  if (-not $epHttp)   { $epHttp   = 'web' }

  Write-Host "  network   : $net"      -ForegroundColor Green
  Write-Host "  resolver  : $resolver" -ForegroundColor Green
  Write-Host "  entrypoint: $epHttps (https) / $epHttp (http)" -ForegroundColor Green

  $envLines = "PROXY_NETWORK=$net`nCERT_RESOLVER=$resolver`nEP_HTTPS=$epHttps`nEP_HTTP=$epHttp`nAQG_DOMAIN=$Domain`nAQG_REQUIRE_CODE=0"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($envLines))
  & ssh $ServerHost "cd $Dir && grep -v -E '^(PROXY_NETWORK|CERT_RESOLVER|EP_HTTPS|EP_HTTP|AQG_DOMAIN|AQG_REQUIRE_CODE)=' .env > .env.tmp; echo '$b64' | base64 -d >> .env.tmp; mv .env.tmp .env; chmod 600 .env"
  if ($LASTEXITCODE -ne 0) { Fail 'เขียน .env บนเซิร์ฟเวอร์ไม่สำเร็จ' }
}

# ── 5. build + run ───────────────────────────────────────────────────────────
Step "build และ start ($compose)"
& ssh $ServerHost "cd $Dir && docker compose -f $compose up -d --build"
if ($LASTEXITCODE -ne 0) { Fail "docker compose ไม่สำเร็จ — ดู log: ssh $ServerHost `"cd $Dir && docker compose -f $compose logs --tail 60`"" }

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
