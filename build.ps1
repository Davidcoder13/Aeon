param(
    [string]$Net = "nets\best.bin"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$netPath = Join-Path $root $Net
$netForEmscripten = $Net.Replace("\", "/")
$dist = Join-Path $PSScriptRoot "dist"
$compilerCommand = Get-Command em++ -ErrorAction SilentlyContinue

if ($compilerCommand) {
    $compilerPath = $compilerCommand.Source
} else {
    $sdkRoot = if ($env:EMSDK) { $env:EMSDK } else { Join-Path $env:USERPROFILE "emsdk" }
    $bundledCompiler = Join-Path $sdkRoot "upstream\emscripten\em++.exe"
    if (-not (Test-Path -LiteralPath $bundledCompiler)) {
        throw "Emscripten was not found. Install the Emscripten SDK or activate it, then rerun web\build.ps1."
    }
    $nodeDir = Get-ChildItem (Join-Path $sdkRoot "node") -Directory | Select-Object -First 1
    $pythonDir = Get-ChildItem (Join-Path $sdkRoot "python") -Directory | Select-Object -First 1
    $env:EMSDK = $sdkRoot
    if ($nodeDir) { $env:EMSDK_NODE = Join-Path $nodeDir.FullName "node.exe" }
    if ($pythonDir) { $env:EMSDK_PYTHON = Join-Path $pythonDir.FullName "python.exe" }
    $env:PATH = "$sdkRoot;$sdkRoot\upstream\emscripten;$env:PATH"
    $compilerPath = $bundledCompiler
}
if (-not (Test-Path -LiteralPath $netPath)) {
    throw "Network file not found: $netPath"
}

New-Item -ItemType Directory -Force $dist | Out-Null
Push-Location $root
try {
    $compilerArgs = @(
        "--std=c++20", "-O3", "-DNDEBUG", "-msimd128", "-Isrc",
        "web/wasm_main.cpp", "-o", "web/dist/aeon.js",
        "-sWASM=1", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=worker",
        "-sEXPORTED_FUNCTIONS=_main,_aeon_init,_aeon_state,_aeon_search,_aeon_new_game",
        "-sEXPORTED_RUNTIME_METHODS=cwrap", "-sNO_EXIT_RUNTIME=1",
        "-sINITIAL_MEMORY=67108864", "-sSTACK_SIZE=1048576", "-sALLOW_MEMORY_GROWTH=1",
        "--preload-file", "$netForEmscripten@/best.bin"
    )
    & $compilerPath @compilerArgs
    if ($LASTEXITCODE -ne 0) { throw "WebAssembly build failed (exit $LASTEXITCODE)" }
    Write-Host "Built web\dist\aeon.js, aeon.wasm and the selected NNUE data package."
} finally {
    Pop-Location
}
