<#
.SYNOPSIS
    Bootstrap and connect a new node to the Sovra Layer-1 testnet (sovra-testnet-0)
    using CometBFT Peer Exchange (PEX) and seed node discovery.

.DESCRIPTION
    1. Probes target seed RPC for chain status and network info.
    2. Downloads canonical genesis.json from the live seed node.
    3. Initializes .sovrad node configuration and validator keyring.
    4. Configures PEX flags and seeds in config.json.
    5. Starts the node daemon and monitors fast-sync catch-up.
#>

param (
    [string]$Moniker = "node4-participant",
    [string]$HomeDir = "chain/mytestnet/node4",
    [string]$SeedRPC = "http://127.0.0.1:26657",
    [int]$P2PPort = 26696,
    [int]$RPCPort = 26697,
    [string]$Passphrase = "sovra-testnet-secret",
    [switch]$NoStart = $false
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  SOVRA LAYER-1 TESTNET BOOTSTRAPPER (sovra-testnet-0)    " -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "Target Moniker:   $Moniker"
Write-Host "Home Directory:   $HomeDir"
Write-Host "Seed RPC:         $SeedRPC"
Write-Host "P2P Listen Port:  $P2PPort"
Write-Host "RPC Listen Port:  $RPCPort"
Write-Host ""

# 1. Probe Seed Node RPC Status
Write-Host "[1/5] Probing seed node at $SeedRPC..." -ForegroundColor Yellow
try {
    $statusRes = Invoke-RestMethod -Uri "$SeedRPC/status" -Method Get -TimeoutSec 5
    $seedMoniker = $statusRes.moniker
    $chainID = $statusRes.chain_id
    $seedHeight = $statusRes.height
    $seedNodeID = $statusRes.node_id
    Write-Host "Connected to Seed Node: $seedMoniker" -ForegroundColor Green
    Write-Host "  Chain ID:             $chainID" -ForegroundColor Green
    Write-Host "  Current Seed Height:  $seedHeight" -ForegroundColor Green
    Write-Host "  Seed Node ID:         $seedNodeID" -ForegroundColor Green
} catch {
    Write-Error "Failed to connect to seed RPC at $SeedRPC. Ensure Node 0 is running."
    exit 1
}

# 2. Download Official Genesis State
Write-Host "`n[2/5] Downloading canonical genesis.json from $SeedRPC/genesis..." -ForegroundColor Yellow
try {
    $genRes = Invoke-RestMethod -Uri "$SeedRPC/genesis" -Method Get -TimeoutSec 5
    if ($genRes.result -and $genRes.result.genesis) {
        $genesisObj = $genRes.result.genesis
    } else {
        $genesisObj = $genRes
    }
    $genesisJson = $genesisObj | ConvertTo-Json -Depth 10
} catch {
    Write-Error "Failed to download genesis from $SeedRPC/genesis: $_"
    exit 1
}

# Extract seed peer address
$seedHost = ([System.Uri]$SeedRPC).Host
$seedP2PPort = 26656
if ($genesisObj.seed_nodes -and $genesisObj.seed_nodes.Count -gt 0) {
    $seedPeerAddr = $genesisObj.seed_nodes[0]
} elseif ($seedNodeID) {
    $seedPeerAddr = "$seedNodeID@${seedHost}:$seedP2PPort"
} else {
    $seedPeerAddr = "node0@${seedHost}:$seedP2PPort"
}
Write-Host "Canonical Seed Peer: $seedPeerAddr" -ForegroundColor Green

# 3. Compile sovrad if needed
$sovradBinary = Join-Path (Get-Location) "chain\sovrad.exe"
if (-not (Test-Path $sovradBinary)) {
    Write-Host "`n[3/5] Building sovrad daemon binary..." -ForegroundColor Yellow
    Push-Location "chain"
    go build -o sovrad.exe ./cmd/sovrad
    Pop-Location
} else {
    Write-Host "`n[3/5] Using existing binary: $sovradBinary" -ForegroundColor Yellow
}

# 4. Initialize Local Node Configuration
Write-Host "`n[4/5] Initializing node in $HomeDir..." -ForegroundColor Yellow
if (-not (Test-Path $HomeDir)) {
    New-Item -ItemType Directory -Path $HomeDir -Force | Out-Null
}

# Initialize node via CLI
& $sovradBinary init $Moniker --home $HomeDir --chain-id $chainID --p2p.pex=true --p2p.seeds $seedPeerAddr --passphrase $Passphrase --insecure-plaintext-keys

# Overwrite with canonical genesis.json from network
$targetGenFile = Join-Path $HomeDir "genesis.json"
[System.IO.File]::WriteAllText($targetGenFile, $genesisJson)
Write-Host "Canonical genesis written to $targetGenFile" -ForegroundColor Green

# Update config.json with custom P2P & RPC ports and seeds
$targetCfgFile = Join-Path $HomeDir "config.json"
if (Test-Path $targetCfgFile) {
    $cfg = Get-Content $targetCfgFile -Raw | ConvertFrom-Json
    $cfg.rpc_port = $RPCPort
    $cfg.rpc_laddr = "tcp://0.0.0.0:$RPCPort"
    $cfg.p2p_port = $P2PPort
    if (-not $cfg.p2p) {
        $cfg | Add-Member -MemberType NoteProperty -Name "p2p" -Value @{}
    }
    $cfg.p2p.laddr = "tcp://0.0.0.0:$P2PPort"
    $cfg.p2p.external_address = "127.0.0.1:$P2PPort"
    $cfg.p2p.pex = $true
    $cfg.p2p.seeds = @($seedPeerAddr)
    $cfg.p2p.max_peers = 50

    $updatedCfgJson = $cfg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($targetCfgFile, $updatedCfgJson)
    Write-Host "Updated $targetCfgFile with P2P port $P2PPort and seed $seedPeerAddr" -ForegroundColor Green
}

if ($NoStart) {
    Write-Host "`nNode configured successfully. Skipping startup (--NoStart)." -ForegroundColor Green
    exit 0
}

# 5. Start Node Daemon
Write-Host "`n[5/5] Starting node daemon with PEX discovery..." -ForegroundColor Yellow
Write-Host "Command: & $sovradBinary start --home $HomeDir --passphrase $Passphrase" -ForegroundColor Cyan

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $sovradBinary
$processInfo.Arguments = "start --home `"$HomeDir`" --passphrase `"$Passphrase`""
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($processInfo)
Start-Sleep -Seconds 2

# Check node health and sync progress
Write-Host "Waiting for node to dial seed and fast-sync block headers..." -ForegroundColor Yellow
$synced = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $myStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$RPCPort/status" -Method Get -TimeoutSec 2
        $myNet = Invoke-RestMethod -Uri "http://127.0.0.1:$RPCPort/net_info" -Method Get -TimeoutSec 2

        $currentHeight = $myStatus.height
        $peersCount = 0
        if ($myNet.result -and $myNet.result.n_peers) {
            $peersCount = $myNet.result.n_peers
        }

        Write-Host "  -> Height: $currentHeight / $seedHeight | Connected Peers: $peersCount" -ForegroundColor Green

        if ($currentHeight -ge $seedHeight -and $currentHeight -gt 0) {
            $synced = $true
            break
        }
    } catch {}
}

if ($synced) {
    Write-Host "`nSUCCESS! Node '$Moniker' successfully caught up to height $currentHeight via PEX and fast-sync." -ForegroundColor Green
} else {
    Write-Host "`nNode '$Moniker' is running (PID: $($proc.Id)) and actively syncing." -ForegroundColor Yellow
}
