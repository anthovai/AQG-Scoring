# รันเซิร์ฟเวอร์ AQG แบบไม่ให้ดับ — ถ้า process ตายจะเปิดใหม่ให้เองใน 3 วินาที
#   .\tools\run-forever.ps1                 # รันในหน้าต่างนี้
#   .\tools\run-forever.ps1 -Register       # ตั้งให้เริ่มเองทุกครั้งที่ล็อกอินเข้า Windows
#   .\tools\run-forever.ps1 -Unregister     # ยกเลิก
#
# บันทึก log ไว้ที่ logs\server.log (ตัดทุก 5 MB) เพื่อดูย้อนหลังว่าเคยดับตอนไหน
param(
  [int]$Port = 5190,
  [switch]$NoCode,
  [switch]$Register,
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$task = 'AQG-Server'

$startup  = [Environment]::GetFolderPath('Startup')
# ใช้ shortcut (.lnk) ไม่ใช่ .cmd เพราะพาธโปรเจกต์มีตัวอักษรไทย
# ซึ่งไฟล์ .cmd (ANSI/OEM codepage) จะอ่านไม่ออก
$launcher = Join-Path $startup 'AQG-Server.lnk'

if ($Unregister) {
  if (Test-Path $launcher) { Remove-Item $launcher -Force }
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'ยกเลิกการเริ่มอัตโนมัติแล้ว'
  exit 0
}

if ($Register) {
  # -EncodedCommand (UTF-16) เพราะ Windows PowerShell 5.1 ส่ง -File ที่พาธมีอักษรไทยไม่ได้
  # พาธจะกลายเป็น ??? แล้วขึ้น "Illegal characters in path"
  $inner = "& '$PSCommandPath' -Port $Port"
  if ($NoCode) { $inner += ' -NoCode' }
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  $a = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $enc"
  $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($launcher)
  $sc.TargetPath       = (Get-Command powershell.exe).Source
  $sc.Arguments        = $a
  $sc.WorkingDirectory = $root
  $sc.WindowStyle      = 7          # ย่อลง taskbar
  $sc.Description      = 'AQG assessment server (auto-restart)'
  $sc.Save()
  Write-Host ('ตั้งให้เริ่มเองเมื่อล็อกอินแล้ว -> ' + $launcher)
  Write-Host ('พอร์ต ' + $Port + ' · ยกเลิกด้วย: .' + [char]92 + 'tools' + [char]92 + 'run-forever.ps1 -Unregister')
  exit 0
}

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
# แยกเป็น 2 ไฟล์: server.log = เหตุการณ์ (เปิดอ่านได้ตลอดเวลา)
#                 server-out.log = ข้อความจากเซิร์ฟเวอร์ (ถูกล็อกระหว่างรัน)
$evt = Join-Path $logDir 'server.log'
$out = Join-Path $logDir 'server-out.log'
function Write-Evt($msg) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" | Add-Content $evt -Encoding UTF8
}

while ($true) {
  foreach ($f in @($evt, $out)) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 5MB)) { Move-Item $f "$f.1" -Force }
  }
  Write-Evt "เริ่มเซิร์ฟเวอร์ พอร์ต $Port"
  try {
    if ($NoCode) { & (Join-Path $root 'start.ps1') -Port $Port -NoCode *>&1 | Out-File $out -Append -Encoding UTF8 }
    else         { & (Join-Path $root 'start.ps1') -Port $Port         *>&1 | Out-File $out -Append -Encoding UTF8 }
  } catch {
    Write-Evt "ผิดพลาด: $_"
  }
  Write-Evt 'เซิร์ฟเวอร์หยุด — จะเริ่มใหม่ใน 3 วินาที'
  Start-Sleep -Seconds 3
}
