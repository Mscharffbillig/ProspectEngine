# Installs the ProspectEngine worker so it starts automatically at every logon.
#
# Primary method (no admin needed): drops a hidden launcher in the current
# user's Startup folder. The worker then polls forever whenever you are logged
# in — no terminal required. Run this once:
#
#   powershell -ExecutionPolicy Bypass -File install-worker-task.ps1
#
# Uninstall: delete "ProspectEngine Worker.vbs" from your Startup folder
#   (Win+R -> shell:startup), or run this script with -Uninstall.
#
# If you prefer a real Scheduled Task and have admin rights, see the commented
# Register-ScheduledTask block at the bottom.
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$launcher = Join-Path $scriptDir "run-worker.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startup "ProspectEngine Worker.vbs"

if ($Uninstall) {
    if (Test-Path $vbsPath) { Remove-Item $vbsPath -Force }
    Write-Host "Removed startup launcher. (Any running worker keeps going until logoff.)"
    return
}

# A .vbs launcher runs PowerShell with no visible window (WScript.Shell.Run
# style 0), so nothing flashes on screen at logon.
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$launcher""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII

# Start it now so you don't have to log out/in first.
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""

Write-Host "Installed. The worker is running now and will auto-start at every logon."
Write-Host "Launcher: $vbsPath"

# ── Admin alternative (real Scheduled Task with auto-restart) ─────────────
# Requires an elevated PowerShell:
#
#   $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
#       -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`"" `
#       -WorkingDirectory $scriptDir
#   $trigger = New-ScheduledTaskTrigger -AtLogOn
#   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
#       -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
#       -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
#   Register-ScheduledTask -TaskName "ProspectEngine Worker" -Action $action `
#       -Trigger $trigger -Settings $settings -RunLevel Limited -Force
