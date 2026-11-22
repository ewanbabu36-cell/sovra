$bin = "D:\Sovra\chain\sovrad_v15_5.exe"
$pass = "sovra-validator-secure-rotated-2026"

for ($i = 0; $i -lt 4; $i++) {
    $homeDir = "D:\Sovra\chain\recovery-testnet\node$i"
    $outLog = "D:\Sovra\chain\recovery-testnet\logs\node$i.log"
    $errLog = "D:\Sovra\chain\recovery-testnet\logs\node$i.err.log"
    $proc = Start-Process -FilePath $bin -ArgumentList "start", "--home", $homeDir, "--passphrase=$pass" -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -NoNewWindow
    Write-Host "Started recovery node$i with PID $($proc.Id) (Home: $homeDir)"
}
