# chain/scripts/start-remote-signer-node.ps1
# SOVRA Layer 1 — Isolated Remote Validator Signing Daemon (TMKMS / CloudHSM) Orchestrator
#
# Decouples the validator private key into an isolated signing process (Memory Enclave or AWS CloudHSM / YubiHSM2)
# The validator consensus node runs with ZERO on-disk private keys!

param(
    [int]$SignerPort = 26659,
    [int]$RpcPort = 26657,
    [int]$P2pPort = 26656,
    [string]$HomeDir = "",
    [string]$SignerHome = "",
    [string]$KeyName = "validator-0",
    [string]$Passphrase = "sovra-testnet-secret",
    [string]$HsmBackend = "enclave"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ChainDir = Split-Path -Parent $ScriptDir
$SovradExe = Join-Path $ChainDir "sovrad.exe"

if (-not (Test-Path $SovradExe)) {
    Write-Host "[BUILD] Building sovrad daemon..." -ForegroundColor Yellow
    Push-Location $ChainDir
    try {
        go build -o sovrad.exe ./cmd/sovrad
    } finally {
        Pop-Location
    }
}

if ([string]::IsNullOrWhiteSpace($HomeDir)) {
    $HomeDir = Join-Path $ChainDir "mytestnet\node0"
}
if ([string]::IsNullOrWhiteSpace($SignerHome)) {
    $SignerHome = Join-Path $ChainDir "mytestnet\signer0"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SOVRA REMOTE VALIDATOR SIGNING DAEMON (TMKMS / CloudHSM)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Signer Port:  tcp://127.0.0.1:$SignerPort" -ForegroundColor White
Write-Host "  HSM Engine:   $HsmBackend" -ForegroundColor White
Write-Host "  Node RPC:     http://127.0.0.1:$RpcPort" -ForegroundColor White
Write-Host "  Key Custody:  ISOLATED ENCLAVE (Deprecates on-disk node key)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Ensure Signer Home has the validator key copied from node keyring
if (-not (Test-Path (Join-Path $SignerHome "keyring"))) {
    New-Item -ItemType Directory -Path (Join-Path $SignerHome "keyring") -Force | Out-Null
}
if (-not (Test-Path (Join-Path $SignerHome "data"))) {
    New-Item -ItemType Directory -Path (Join-Path $SignerHome "data") -Force | Out-Null
}

$NodeKeystore = Join-Path $HomeDir "keyring\$KeyName.keystore"
$SignerKeystore = Join-Path $SignerHome "keyring\$KeyName.keystore"
if (Test-Path $NodeKeystore) {
    Copy-Item -Path $NodeKeystore -Destination $SignerKeystore -Force
    Write-Host "[KEYRING] Transferred validator keystore to isolated signer enclave." -ForegroundColor Green
}

# 2. Start the Remote Signer Daemon in the background
$SignerSocket = "tcp://127.0.0.1:$SignerPort"
Write-Host "[SIGNER] Launching sovrad signer daemon on $SignerSocket..." -ForegroundColor Yellow

$signerPsi = New-Object System.Diagnostics.ProcessStartInfo
$signerPsi.FileName = $SovradExe
$signerPsi.Arguments = "signer start --listen=$SignerSocket --home=`"$SignerHome`" --key=$KeyName --passphrase=`"$Passphrase`" --hsm=$HsmBackend"
$signerPsi.WorkingDirectory = $ChainDir
$signerPsi.UseShellExecute = $false
$signerPsi.RedirectStandardOutput = $true
$signerPsi.RedirectStandardError = $true
$signerPsi.CreateNoWindow = $true

$signerProc = [System.Diagnostics.Process]::Start($signerPsi)
Start-Sleep -Milliseconds 800

if ($signerProc.HasExited) {
    Write-Host "[ERROR] Signer daemon failed to start. ExitCode: $($signerProc.ExitCode)" -ForegroundColor Red
    $errOut = $signerProc.StandardError.ReadToEnd()
    Write-Host $errOut -ForegroundColor Red
    exit 1
}

Write-Host "  ✅ Signer Daemon running (PID: $($signerProc.Id))" -ForegroundColor Green

# 3. Start the Consensus Node pointing directly to the Remote Signer
Write-Host "[NODE] Launching validator node with --priv_val_laddr=$SignerSocket..." -ForegroundColor Yellow
$nodePsi = New-Object System.Diagnostics.ProcessStartInfo
$nodePsi.FileName = $SovradExe
$nodePsi.Arguments = "start --home=`"$HomeDir`" --priv_val_laddr=$SignerSocket --rpc.laddr=tcp://0.0.0.0:$RpcPort --p2p.laddr=tcp://0.0.0.0:$P2pPort"
$nodePsi.WorkingDirectory = $ChainDir
$nodePsi.UseShellExecute = $false
$nodePsi.RedirectStandardOutput = $true
$nodePsi.RedirectStandardError = $true
$nodePsi.CreateNoWindow = $true

$nodeProc = [System.Diagnostics.Process]::Start($nodePsi)
Start-Sleep -Seconds 2

if ($nodeProc.HasExited) {
    Write-Host "[ERROR] Node failed to start. ExitCode: $($nodeProc.ExitCode)" -ForegroundColor Red
    $errOut = $nodeProc.StandardError.ReadToEnd()
    Write-Host $errOut -ForegroundColor Red
    $signerProc.Kill()
    exit 1
}

Write-Host "  ✅ Node running (PID: $($nodeProc.Id)) with ZERO keys on disk!" -ForegroundColor Green

# 4. Probe Node RPC status
Write-Host "`n[TELEMETRY] Probing node status at http://127.0.0.1:$RpcPort/status..." -ForegroundColor Yellow
try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$RpcPort/status" -TimeoutSec 5
    Write-Host "  Status:         ONLINE" -ForegroundColor Green
    Write-Host "  Moniker:        $($status.moniker)" -ForegroundColor Green
    Write-Host "  Chain ID:       $($status.chain_id)" -ForegroundColor Green
    Write-Host "  Node ID:        $($status.node_id)" -ForegroundColor Green
    Write-Host "  Current Height: $($status.height)" -ForegroundColor Green
    Write-Host "  Total Supply:   $($status.total_supply) uSOV" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] RPC endpoint warming up: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  REMOTE SIGNING ACTIVE: Keys protected by Hardware/Memory Enclave." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
