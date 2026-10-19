# scripts/stop-local-testnet.ps1
# Gracefully terminates all running sovrad validator node processes.

$ErrorActionPreference = "SilentlyContinue"
$procs = Get-Process -Name "sovrad" -ErrorAction SilentlyContinue

if ($procs) {
    Write-Host "Stopping $($procs.Count) running sovrad validator node(s)..." -ForegroundColor Yellow
    $procs | ForEach-Object {
        Write-Host "  Stopping PID $($_.Id)..." -ForegroundColor DarkGray
        Stop-Process -Id $_.Id -Force
    }
    Write-Host "All sovrad nodes stopped." -ForegroundColor Green
} else {
    Write-Host "No active sovrad processes found." -ForegroundColor DarkGray
}
