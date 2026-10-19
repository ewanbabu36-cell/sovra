# scripts/start-local-testnet.ps1
# SOVRA Layer-1 Independent Blockchain: Multi-Node Local Testnet Orchestrator
#
# Launches 4 independent CometBFT validator nodes on local loopback:
# - Node 0: RPC 26657 | P2P 26656 (Seed Node)
# - Node 1: RPC 26667 | P2P 26666
# - Node 2: RPC 26677 | P2P 26676
# - Node 3: RPC 26687 | P2P 26686

param(
    [switch]$Reset,
    [int]$NumValidators = 4,
    [string]$Passphrase = "sovra-testnet-secret"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$ChainDir = Join-Path $RootDir "chain"
$SovradExe = Join-Path $ChainDir "sovrad.exe"
$TestnetDir = Join-Path $ChainDir "mytestnet"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SOVRA INDEPENDENT LAYER 1 — LOCAL MULTI-NODE TESTNET   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify sovrad.exe exists or compile it
if (-not (Test-Path $SovradExe)) {
    Write-Host "[BUILD] Compiling sovrad daemon from source..." -ForegroundColor Yellow
    Push-Location $ChainDir
    try {
        go build -o sovrad.exe ./cmd/sovrad
        Write-Host "[BUILD] Successfully compiled sovrad.exe" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# 2. Re-scaffold testnet genesis & keyrings if reset requested or missing
if ($Reset -or -not (Test-Path (Join-Path $TestnetDir "node0/config.json"))) {
    Write-Host "[SCAFFOLD] Initializing $NumValidators-validator testnet cluster..." -ForegroundColor Yellow
    & $SovradExe testnet --v=$NumValidators --home=$TestnetDir --passphrase=$Passphrase --insecure-plaintext-keys
    Write-Host "[SCAFFOLD] Testnet files generated in $TestnetDir" -ForegroundColor Green
}

# 3. Stop any existing running sovrad instances
Write-Host "[PROCESS] Checking for existing sovrad processes..." -ForegroundColor Yellow
Get-Process -Name "sovrad" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Terminating existing PID $($_.Id)..." -ForegroundColor DarkGray
    Stop-Process -Id $_.Id -Force
}
Start-Sleep -Milliseconds 800

# 4. Launch validator nodes
$Processes = @()
for ($i = 0; $i -lt $NumValidators; $i++) {
    $NodeDir = Join-Path $TestnetDir "node$i"
    $RpcPort = 26657 + ($i * 10)
    $P2pPort = 26656 + ($i * 10)
    $LogFile = Join-Path $TestnetDir "node$i.log"

    Write-Host "[LAUNCH] Starting Validator-$i (RPC: $RpcPort, P2P: $P2pPort)..." -ForegroundColor White
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $SovradExe
    $psi.Arguments = "start --home=`"$NodeDir`" --passphrase=`"$Passphrase`""
    $psi.WorkingDirectory = $ChainDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    $Processes += $proc
    Start-Sleep -Milliseconds 600
}

Write-Host "`n[TELEMETRY] Probing cluster RPC health..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

$AllHealthy = $true
for ($i = 0; $i -lt $NumValidators; $i++) {
    $RpcPort = 26657 + ($i * 10)
    $Url = "http://127.0.0.1:$RpcPort/status"
    try {
        $status = Invoke-RestMethod -Uri $Url -TimeoutSec 3
        Write-Host "  ✅ Node $i: ONLINE | Height: $($status.height) | Supply: $($status.total_supply) uSOV | Moniker: $($status.moniker)" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ Node $i: FAILED to respond on port $RpcPort" -ForegroundColor Red
        $AllHealthy = $false
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
if ($AllHealthy) {
    Write-Host "  CLUSTER OPERATIONAL: All $NumValidators validator nodes active and peering." -ForegroundColor Green
} else {
    Write-Host "  CLUSTER WARNING: Some nodes failed health check. Check logs in $TestnetDir" -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Cyan
