# Launches the ProspectEngine research worker in continuous poll mode.
# Used by the "ProspectEngine Worker" scheduled task (see install-worker-task.ps1)
# so discovery/crawl/score tasks are processed automatically whenever you are
# logged in — no need to keep a terminal open.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# Single-instance guard: if a poll worker is already running, do nothing. Keeps
# repeated logons from stacking up duplicate workers.
$existing = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*worker.main*poll*" -and $_.ProcessId -ne $PID }
if ($existing) { exit 0 }

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"  # fall back to PATH if the venv is missing
}

& $python -m worker.main poll
