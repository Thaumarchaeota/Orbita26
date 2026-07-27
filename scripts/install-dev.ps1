$ErrorActionPreference = "Stop"
$programs = if ($env:ORBITA_PROGRAMS) { $env:ORBITA_PROGRAMS } else { Join-Path $env:USERPROFILE "programs" }
$nodeDir = "$programs\nodejs"
$rustDir = "$programs\rust"
$nodeVer = "22.14.0"
$nodeZip = "node-v$nodeVer-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVer/$nodeZip"
$rustupUrl = "https://win.rustup.rs/x86_64"

New-Item -ItemType Directory -Force -Path $programs | Out-Null

if (-not (Test-Path "$nodeDir\node.exe")) {
    Write-Host "Installing Node.js to $nodeDir ..."
    $tmp = Join-Path $env:TEMP $nodeZip
    Invoke-WebRequest -Uri $nodeUrl -OutFile $tmp -UseBasicParsing
    $extract = Join-Path $env:TEMP "node-extract"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $tmp -DestinationPath $extract
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    Move-Item (Join-Path $extract "node-v$nodeVer-win-x64") $nodeDir
    Remove-Item $tmp, $extract -Force -ErrorAction SilentlyContinue
}

$env:RUSTUP_HOME = "$rustDir\.rustup"
$env:CARGO_HOME = "$rustDir\.cargo"
[Environment]::SetEnvironmentVariable("RUSTUP_HOME", $env:RUSTUP_HOME, "User")
[Environment]::SetEnvironmentVariable("CARGO_HOME", $env:CARGO_HOME, "User")

if (-not (Test-Path "$env:CARGO_HOME\bin\cargo.exe")) {
    Write-Host "Installing Rust to $rustDir ..."
    $rustup = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustup -UseBasicParsing
    & $rustup -y --default-toolchain stable --profile minimal
    Remove-Item $rustup -Force -ErrorAction SilentlyContinue
}

$paths = @($nodeDir, "$env:CARGO_HOME\bin")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
foreach ($p in $paths) {
    if ($userPath -notlike "*$p*") { $userPath = "$p;$userPath" }
}
[Environment]::SetEnvironmentVariable("Path", $userPath.TrimEnd(";"), "User")
$env:Path = ($paths -join ";") + ";" + $env:Path

Write-Host "Node: $( & "$nodeDir\node.exe" --version )"
Write-Host "Cargo: $( & "$env:CARGO_HOME\bin\cargo.exe" --version )"
Write-Host "Done."
