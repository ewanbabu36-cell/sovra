$ports = @(26757, 26767, 26777, 26787)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        $pidToKill = $conn.OwningProcess | Select-Object -Unique
        foreach ($p in $pidToKill) {
            Write-Host "Stopping recovery node on port $port (PID: $p)..."
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Write-Host "Recovery cluster shutdown complete."
