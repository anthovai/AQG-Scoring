# สร้างไฟล์วีดีโอรุ่นเว็บ (video/S0X-web.mp4) จากไฟล์ต้นฉบับ
#   .\tools\compress-video.ps1              # ทำทั้ง S00 S01 S02 S03
#   .\tools\compress-video.ps1 -Crf 20      # คุณภาพสูงขึ้น (ไฟล์ใหญ่ขึ้น)
#
# ต้นฉบับ 1080p25 ~13-16 Mbps  →  CRF 22 ได้ประมาณ 2.5-3.5 Mbps (เล็กลง ~4.5 เท่า)
# ตัวหนังสือไทยบนการ์ดตัวเลือกยังคมชัด และ "จังหวะ (cue) ไม่เปลี่ยน" เพราะไม่ได้ตัดต่อเนื้อหา
# ไฟล์ต้นฉบับถูกเก็บไว้เป็น master — แอปจะใช้ -web ก่อน ถ้าไม่มีจะถอยไปใช้ต้นฉบับเอง
param(
  [string[]]$Names = @('S00', 'S01', 'S02', 'S03'),
  [int]$Crf = 22,
  [string]$Preset = 'medium'
)

$root = Split-Path -Parent $PSScriptRoot
$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ff) { Write-Error 'ไม่พบ ffmpeg ใน PATH (ติดตั้ง: winget install Gyan.FFmpeg)'; exit 1 }

foreach ($n in $Names) {
  $src = Join-Path $root "video\$n.mp4"
  $out = Join-Path $root "video\$n-web.mp4"
  if (-not (Test-Path $src)) { Write-Warning "ข้าม $n — ไม่พบ $src"; continue }

  Write-Host "กำลังบีบอัด $n (CRF $Crf, preset $Preset) ..."
  & $ff -y -hide_banner -loglevel error -i $src `
    -c:v libx264 -crf $Crf -preset $Preset -pix_fmt yuv420p `
    -c:a aac -b:a 128k -movflags +faststart $out
  if ($LASTEXITCODE -ne 0) { Write-Error "บีบอัด $n ไม่สำเร็จ"; continue }

  $a = (Get-Item $src).Length / 1MB
  $b = (Get-Item $out).Length / 1MB
  Write-Host ("  {0}: {1:N0} MB -> {2:N0} MB ({3:N1} เท่า)" -f $n, $a, $b, ($a / $b))
}

Write-Host "`nเสร็จแล้ว — ตรวจด้วย: node tools\check.js  แล้วลองเล่น 1 รอบ"
