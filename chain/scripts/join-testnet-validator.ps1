# ==============================================================================
# SOVRA PHASE 2 TESTNET — COMMUNITY VALIDATOR JOIN SCRIPT (PowerShell)
# Chain ID: sovra-testnet-0
# ==============================================================================

param (
    [string]$Moniker = "community-validator-$(Get-Random -Minimum 100 -Maximum 999)",
    [string]$Home = "$HOME/.sovrad",
    [string]$Passphrase = "sovra-testnet-secret",
    [string]$PrivValLAddr = "",
    [switch]$RunAsDaemon
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SOVRA PHASE 2 TESTNET: COMMUNITY VALIDATOR ONBOARDING" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Moniker:              $Moniker"
Write-Host "Node Home Directory:  $Home"
Write-Host "Remote Signer Socket: $(if ($PrivValLAddr) { $PrivValLAddr } else { 'Disabled (Local Enclave Keystore)' })"

# 1. Locate sovrad binary
$SovradBinary = Join-Path $PSScriptRoot "..\sovrad.exe"
if (-not (Test-Path $SovradBinary)) {
    $SovradBinary = Join-Path (Get-Location) "chain\sovrad.exe"
}
if (-not (Test-Path $SovradBinary)) {
    Write-Error "Cannot locate sovrad.exe. Please build it first: cd chain; go build -o sovrad.exe ./cmd/sovrad"
}

# 2. Initialize node configuration
Write-Host "`n[1/5] Initializing local node configuration..." -ForegroundColor Yellow
& $SovradBinary init $Moniker --home="$Home" --passphrase="$Passphrase"

# 3. Install Phase 2 Canonical Genesis
$GenesisSrc = Join-Path $PSScriptRoot "..\genesis-phase2-public.json"
if (-not (Test-Path $GenesisSrc)) {
    $GenesisSrc = Join-Path (Get-Location) "chain\genesis-phase2-public.json"
}
$GenesisDest = Join-Path $Home "genesis.json"
Write-Host "[2/5] Installing Phase 2 canonical genesis to $GenesisDest..." -ForegroundColor Yellow
Copy-Item -Path $GenesisSrc -Destination $GenesisDest -Force

# 4. Inject Seed Nodes into config.json
$ConfigFile = Join-Path $Home "config.json"
Write-Host "[3/5] Configuring public seed nodes in $ConfigFile..." -ForegroundColor Yellow
$Config = Get-Content $ConfigFile | ConvertFrom-Json

$SeedsFile = Join-Path $PSScriptRoot "..\seeds.txt"
if (-not (Test-Path $SeedsFile)) {
    $SeedsFile = Join-Path (Get-Location) "chain\seeds.txt"
}

$SeedNodes = @()
if (Test-Path $SeedsFile) {
    $SeedNodes = Get-Content $SeedsFile | Where-Object { $_ -and -not $_.StartsWith("#") }
}

if ($SeedNodes.Count -eq 0) {
    $SeedNodes = @("2a806ca82d506a025d580d40600abc77a69e10e7@127.0.0.1:26656")
}

$Config.p2p.seeds = $SeedNodes
$Config.p2p.pex = $true
if ($PrivValLAddr) {
    $Config.priv_val_laddr = $PrivValLAddr
}
$Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile

# 5. Launch node
Write-Host "[4/5] Node configuration verified!" -ForegroundColor Green
Write-Host "  Seeds configured: $($SeedNodes.Count) seed relays"
Write-Host "  P2P Port:        $($Config.p2p_port)"
Write-Host "  RPC Port:        $($Config.rpc_port)"

Write-Host "`n[5/5] Ready to start synchronization." -ForegroundColor Green
Write-Host "To start your node in foreground:" -ForegroundColor Cyan
if ($PrivValLAddr) {
    Write-Host "  $SovradBinary start --home=`"$Home`" --priv_val_laddr=`"$PrivValLAddr`"" -ForegroundColor White
} else {
    Write-Host "  $SovradBinary start --home=`"$Home`" --passphrase=`"$Passphrase`"" -ForegroundColor White
}

Write-Host "`nTo check chain sync status:" -ForegroundColor Cyan
Write-Host "  curl -s http://127.0.0.1:$($Config.rpc_port)/status" -ForegroundColor White

if ($RunAsDaemon) {
    Write-Host "`nStarting node in background..." -ForegroundColor Yellow
    $StartArgs = @("start", "--home=$Home")
    if ($PrivValLAddr) {
        $StartArgs += "--priv_val_laddr=$PrivValLAddr"
    } else {
        $StartArgs += "--passphrase=$Passphrase"
    }
    Start-Process -FilePath $SovradBinary -ArgumentList $StartArgs -NoNewWindow
    Write-Host "Node process started." -ForegroundColor Green
}
