# ==============================================================================
# SOVRA PHASE 2 TESTNET — SEED NODE ORCHESTRATION SCRIPT
# Deploys independent public seed discovery relays across distinct P2P ports
# ==============================================================================

param (
    [int]$NumSeeds = 3,
    [string]$BaseDir = "mytestnet_seeds",
    [switch]$KillExisting
)

$ErrorActionPreference = "Stop"

$SovradBinary = Join-Path $PSScriptRoot "..\sovrad.exe"
if (-not (Test-Path $SovradBinary)) {
    $SovradBinary = Join-Path (Get-Location) "chain\sovrad.exe"
}
if (-not (Test-Path $SovradBinary)) {
    Write-Error "Cannot locate sovrad.exe. Build first with: cd chain; go build -o sovrad.exe ./cmd/sovrad"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SOVRA PHASE 2 TESTNET: ORCHESTRATING $NumSeeds SEED RELAYS" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$GenesisPath = Join-Path $PSScriptRoot "..\genesis-phase2-public.json"
if (-not (Test-Path $GenesisPath)) {
    $GenesisPath = Join-Path (Get-Location) "chain\genesis-phase2-public.json"
}

$SeedEndpoints = @()

for ($i = 0; $i -lt $NumSeeds; $i++) {
    $SeedDir = Join-Path $BaseDir "seed$i"
    $P2PPort = 26656 + ($i * 100)
    $RPCPort = 26657 + ($i * 100)
    $Moniker = "public-seed-$i"

    Write-Host "`nSetting up Seed Node $i ($Moniker) on P2P Port $P2PPort, RPC $RPCPort..." -ForegroundColor Yellow
    _ = Remove-Item -Path (Join-Path $SeedDir "data") -Recurse -Force -ErrorAction SilentlyContinue
    _ = New-Item -ItemType Directory -Path $SeedDir -Force

    # Initialize seed node
    & $SovradBinary init $Moniker --home="$SeedDir" --passphrase="sovra-seed-cluster-secret"

    # Install Phase 2 Canonical Genesis
    Copy-Item -Path $GenesisPath -Destination (Join-Path $SeedDir "genesis.json") -Force

    # Update config.json to run in dedicated Seed Mode (PEX enabled, non-validating)
    $ConfigFile = Join-Path $SeedDir "config.json"
    $Config = Get-Content $ConfigFile | ConvertFrom-Json
    $Config.p2p_port = $P2PPort
    $Config.rpc_port = $RPCPort
    $Config.rpc_laddr = "tcp://0.0.0.0:$RPCPort"
    $Config.p2p.laddr = "tcp://0.0.0.0:$P2PPort"
    $Config.p2p.external_address = "127.0.0.1:$P2PPort"
    $Config.p2p.pex = $true

    $Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile

    $NodeID = $Config.node_id
    $SeedEndpoint = "$NodeID@127.0.0.1:$P2PPort"
    $SeedEndpoints += $SeedEndpoint

    Write-Host "  Configured Seed Node $i: $SeedEndpoint" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  SEED NODE ORCHESTRATION COMPLETED" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
foreach ($s in $SeedEndpoints) {
    Write-Host "  Seed URI: $s" -ForegroundColor White
}

Write-Host "`nTo start Seed 0 in background:" -ForegroundColor Cyan
Write-Host "  Start-Process $SovradBinary -ArgumentList `"start --home=$BaseDir/seed0`" -NoNewWindow" -ForegroundColor White
