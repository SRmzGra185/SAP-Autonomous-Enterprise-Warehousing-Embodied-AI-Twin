$PidFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".soxtech-server.pid"
if (Test-Path $PidFile) {
  $ServerPid = [int](Get-Content $PidFile | Select-Object -First 1)
  Stop-Process -Id $ServerPid -ErrorAction SilentlyContinue
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  Write-Host "SOXTECH desktop API stopped."
} else {
  Write-Host "No SOXTECH desktop API PID file was found."
}
