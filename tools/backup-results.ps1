# สำรองผลการประเมิน (results\) ไปยังปลายทางที่กำหนด
#   .\tools\backup-results.ps1                          # สำรองไป ..\aqg-backup
#   .\tools\backup-results.ps1 -Dest "D:\backup\aqg"    # กำหนดปลายทางเอง
#   .\tools\backup-results.ps1 -Register                # ตั้งให้รันอัตโนมัติทุกวัน 18:00
#   .\tools\backup-results.ps1 -Unregister              # ยกเลิกงานอัตโนมัติ
#
# เก็บเป็นโฟลเดอร์ตามวันที่ + zip หนึ่งไฟล์ต่อครั้ง และลบสำรองที่เก่ากว่า 90 วันทิ้ง
param(
  [string]$Dest,
  [switch]$Register,
  [switch]$Unregister,
  [string]$At = '18:00',
  [int]$KeepDays = 90
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path (Split-Path -Parent $root) 'aqg-backup' }
$task = 'AQG-Backup-Results'

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "ยกเลิกงานสำรองอัตโนมัติแล้ว ($task)"
  exit 0
}

if ($Register) {
  # -EncodedCommand (UTF-16): Windows PowerShell 5.1 ส่ง -File ที่พาธมีอักษรไทยไม่ได้
  $inner  = "& '$PSCommandPath' -Dest '$Dest'"
  $enc    = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $enc"
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Force | Out-Null
  Write-Host "ตั้งงานสำรองอัตโนมัติแล้ว: ทุกวัน $At → $Dest"
  Write-Host ('ตรวจ/ยกเลิก: Get-ScheduledTask ' + $task + '  |  .' + [char]92 + 'tools' + [char]92 + 'backup-results.ps1 -Unregister')
  exit 0
}

$src = Join-Path $root 'results'
if (-not (Test-Path $src)) { Write-Host 'ยังไม่มีโฟลเดอร์ results (ยังไม่มีใครเล่นจบ) — ข้าม'; exit 0 }

New-Item -ItemType Directory -Force $Dest | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$zip = Join-Path $Dest "aqg-results_$stamp.zip"
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip -Force

$files = (Get-ChildItem $src -File).Count
$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "สำรองแล้ว: $files ไฟล์ → $zip ($size KB)"

# ลบสำรองเก่าเกิน $KeepDays วัน
Get-ChildItem $Dest -Filter 'aqg-results_*.zip' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "ลบสำรองเก่า: $($_.Name)" }
