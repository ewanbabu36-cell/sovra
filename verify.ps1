# D:\Sovra\verify.ps1
# One-click test runner & verifier for Sovra

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = "D:\Sovra" }

Set-Location $ProjectRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "             SOVRA TEST & VERIFICATION RUNNER             " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Directory: $ProjectRoot`n" -ForegroundColor DarkGray

# 1. Vitest L1 Integration & Trading Engine Tests
Write-Host "[1/3] Running Vitest Integration & Trading Engine Tests..." -ForegroundColor Yellow
npx vitest run tests/integration/sovra-l1-blockchain.test.ts tests/e2e/fractional-coin-trading-engine.test.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Vitest tests failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Vitest suites passed!`n" -ForegroundColor Green

# 2. Chain Go Unit & Integration Tests
Write-Host "[2/3] Running Chain Go Unit & Integration Tests..." -ForegroundColor Yellow
Push-Location "$ProjectRoot\chain"
try {
    go test ./...
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Go tests failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Chain Go tests passed!`n" -ForegroundColor Green
} finally {
    Pop-Location
}

# 3. sovrad CLI Signer Verification
Write-Host "[3/3] Verifying sovrad signer CLI binary..." -ForegroundColor Yellow
$SovradExe = "$ProjectRoot\chain\sovrad.exe"
if (-not (Test-Path $SovradExe)) {
    Push-Location "$ProjectRoot\chain"
    try {
        go build -o sovrad.exe ./cmd/sovrad
    } finally {
        Pop-Location
    }
}
& $SovradExe signer --help
Write-Host "`n✅ All checks passed successfully!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
