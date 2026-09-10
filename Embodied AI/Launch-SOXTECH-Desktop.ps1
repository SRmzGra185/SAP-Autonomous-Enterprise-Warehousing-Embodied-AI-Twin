param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDirectory = Join-Path $Project ".runtime"
$LauncherLog = Join-Path $RuntimeDirectory "launcher.log"
$ServerOutputLog = Join-Path $RuntimeDirectory "server.stdout.log"
$ServerErrorLog = Join-Path $RuntimeDirectory "server.stderr.log"
$PidFile = Join-Path $Project ".soxtech-server.pid"
$EnvFile = Join-Path $Project ".env"
$Port = 4173

# Some desktop shells expose both PATH and Path. Windows treats them as the
# same variable, but PowerShell cannot start a child process until normalized.
$ProcessPath = $env:Path
Remove-Item Env:PATH -ErrorAction SilentlyContinue
$env:Path = $ProcessPath

New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

function Write-LaunchLog([string]$Message) {
  Add-Content -LiteralPath $LauncherLog -Value "$(Get-Date -Format o) $Message"
}

function Test-AppHealth([string]$Url) {
  try {
    $Health = Invoke-RestMethod "$Url/api/health" -TimeoutSec 2
    if (-not $Health.ok) { return $false }
    $Page = Invoke-WebRequest "$Url/" -UseBasicParsing -TimeoutSec 3
    return $Page.StatusCode -eq 200 -and $Page.Content -match 'id="webgl-world"'
  } catch {
    return $false
  }
}

function Resolve-NodeExecutable {
  $BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $BundledNode) { return $BundledNode }

  $SystemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($SystemNode -and (Test-Path $SystemNode.Source)) { return $SystemNode.Source }

  throw "Node.js 20 or newer was not found. Install Node.js from https://nodejs.org/ and launch again."
}

function Open-DesktopWindow([string]$Url) {
  $BrowserProfile = Join-Path $RuntimeDirectory "desktop-browser-profile"
  New-Item -ItemType Directory -Path $BrowserProfile -Force | Out-Null
  $AppArguments = @("--user-data-dir=$BrowserProfile", "--app=$Url", "--start-maximized", "--no-first-run", "--disable-default-apps")
  $Candidates = @(
    @{ Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; Args = $AppArguments },
    @{ Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; Args = $AppArguments },
    @{ Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; Args = $AppArguments },
    @{ Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; Args = $AppArguments }
  )

  foreach ($Candidate in $Candidates) {
    if ($Candidate.Path -and (Test-Path $Candidate.Path)) {
      Start-Process -FilePath $Candidate.Path -ArgumentList $Candidate.Args | Out-Null
      Write-LaunchLog "Opened desktop window with $($Candidate.Path)."
      return
    }
  }

  Start-Process -FilePath "explorer.exe" -ArgumentList $Url | Out-Null
  Write-LaunchLog "Opened the system default browser."
}

try {
  Write-LaunchLog "Launch requested."

  if (Test-Path $EnvFile) {
    $PortLine = Get-Content $EnvFile | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -First 1
    if ($PortLine) { $Port = [int](($PortLine -split '=', 2)[1].Trim()) }
  }

  $Url = "http://127.0.0.1:$Port"
  $Healthy = Test-AppHealth $Url

  if (-not $Healthy) {
    if (Test-Path $PidFile) {
      $PreviousPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
      if (-not (Get-Process -Id $PreviousPid -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      }
    }

    $Node = Resolve-NodeExecutable
    $NodeMajor = [int]((& $Node --version).TrimStart('v').Split('.')[0])
    if ($NodeMajor -lt 20) { throw "Node.js 20 or newer is required; found version $NodeMajor at $Node." }

    Remove-Item -LiteralPath $ServerOutputLog,$ServerErrorLog -Force -ErrorAction SilentlyContinue
    $Arguments = if (Test-Path $EnvFile) { @("--env-file=$EnvFile", "server.mjs") } else { @("server.mjs") }
    $Process = Start-Process -FilePath $Node -ArgumentList $Arguments -WorkingDirectory $Project -WindowStyle Hidden -RedirectStandardOutput $ServerOutputLog -RedirectStandardError $ServerErrorLog -PassThru
    Set-Content -LiteralPath $PidFile -Value $Process.Id
    Write-LaunchLog "Started API process $($Process.Id) with $Node on port $Port."

    for ($Attempt = 0; $Attempt -lt 60; $Attempt += 1) {
      Start-Sleep -Milliseconds 250
      if ($Process.HasExited) { break }
      if (Test-AppHealth $Url) { $Healthy = $true; break }
    }

    if (-not $Healthy) {
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      $Details = if (Test-Path $ServerErrorLog) { (Get-Content -LiteralPath $ServerErrorLog -Tail 20) -join [Environment]::NewLine } else { "No server error log was produced." }
      throw "The API did not become ready at $Url.$([Environment]::NewLine)$Details"
    }
  } else {
    Write-LaunchLog "Reused the healthy API at $Url."
  }

  if (-not $NoOpen) { Open-DesktopWindow $Url }
  Write-LaunchLog "Launch completed successfully at $Url."
  exit 0
} catch {
  Write-LaunchLog "FAILED: $($_.Exception.Message)"
  Write-Error "SOXTECH launch failed: $($_.Exception.Message)"
  exit 1
}
