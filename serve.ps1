param(
    [int]$Port = 8000,
    [string]$Python = ".venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$pythonPath = Join-Path $root $Python
if (-not (Test-Path -LiteralPath $pythonPath)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw "Python was not found. Install Python or pass -Python with its path." }
    $pythonPath = $pythonCommand.Source
}

Write-Host "Serving static files at http://localhost:$Port/ (Ctrl+C to stop)."
Push-Location $PSScriptRoot
try {
    & $pythonPath -m http.server $Port
} finally {
    Pop-Location
}
