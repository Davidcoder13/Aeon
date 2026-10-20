param(
    [string]$Data = "data\gen10_*.bin",
    [int]$Epochs = 6,
    [int]$Batch = 16384,
    [int]$Threads = 10,
    [string]$Device = "auto",
    [string]$Out = "nets\web_h128_candidate.npz"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "Project Python environment not found: $python" }
Push-Location $root
try {
    & $python "tools\nnue\train.py" --data $Data --hidden 128 --epochs $Epochs --batch $Batch --device $Device --threads $Threads --out $Out
    if ($LASTEXITCODE -ne 0) { throw "Training failed (exit $LASTEXITCODE)" }
    $binary = [System.IO.Path]::ChangeExtension($Out, ".bin")
    & $python "tools\nnue\export.py" $Out $binary
    if ($LASTEXITCODE -ne 0) { throw "Network export failed (exit $LASTEXITCODE)" }
    Write-Host "Candidate exported to $binary; it has not replaced nets\best.bin."
} finally {
    Pop-Location
}
