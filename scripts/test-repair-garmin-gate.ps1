<#
Dependency-free regression checks for repair-garmin-gate.ps1.
Run explicitly from the repository root with PowerShell; all fixtures live under a
fresh temporary directory. This script deliberately replaces the process guard so
the fixture tests never inspect or affect a real Orbita process.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:RepairScript = Join-Path $PSScriptRoot 'repair-garmin-gate.ps1'
$script:FixtureJunctionPaths = [System.Collections.Generic.List[string]]::new()
. $script:RepairScript

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $thrown = $false
    try { & $Action } catch { $thrown = $true }
    if (-not $thrown) { throw $Message }
}

function Invoke-Check {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
        $script:Passed++
        Write-Host "PASS $Name"
    } catch {
        $script:Failed++
        Write-Host "FAIL $Name - $($_.Exception.Message)"
    }
}

function New-GarminFixture {
    param([string]$Root, [string]$TokenDir = '')
    $config = Join-Path $Root 'config'
    $appData = Join-Path $Root 'appdata'
    $data = Join-Path $Root 'user-data'
    $fixtureHomePath = Join-Path $Root 'legacy-home'
    foreach ($dir in @($config, $appData, $data, $fixtureHomePath)) {
        [void][System.IO.Directory]::CreateDirectory($dir)
    }
    $bootstrap = @{ data_dir = $data } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText((Join-Path $appData 'bootstrap.json'), $bootstrap)
    $garmin = @{}
    if ($TokenDir) { $garmin.tokenDir = $TokenDir }
    $settings = @{ integrations = @{ garmin = $garmin } } | ConvertTo-Json -Depth 8 -Compress
    [System.IO.File]::WriteAllText((Join-Path $data 'settings.json'), $settings)
    return [pscustomobject]@{ Root = $Root; Config = $config; AppData = $appData; Data = $data; Home = $fixtureHomePath }
}

function Invoke-Repair {
    param($Fixture, [switch]$Initialize, [switch]$InspectOnly)
    Invoke-GarminGateRepair -Initialize:$Initialize -InspectOnly:$InspectOnly `
        -AppConfigRoot $Fixture.Config -AppDataRoot $Fixture.AppData -LegacyHomeRoot $Fixture.Home
}

function Get-TreeDigest {
    param([string]$Root)
    $entries = @(Get-ChildItem -LiteralPath $Root -Force -Recurse | Sort-Object FullName | ForEach-Object {
        if ($_.PSIsContainer) { "D:$($_.FullName.Substring($Root.Length))" }
        else { "F:$($_.FullName.Substring($Root.Length)):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    })
    return ($entries -join "`n")
}

# Deliberately shadow Get-Process for this test session. The production process
# guard remains under test, while no real process list is queried or modified.
$script:MockProcessMode = 'none'
function Get-Process {
    param([string]$Name, [string]$ErrorAction)
    if ($script:MockProcessMode -eq 'error') { throw 'synthetic process enumeration error' }
    if ($script:MockProcessMode -eq 'orbita') { return [pscustomobject]@{ ProcessName = 'orbita' } }
    return @()
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('orbita-garmin-gate-tests-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($tempRoot)
try {
    Invoke-Check 'dot-source defines functions without executing repair' {
        $root = Join-Path $tempRoot 'dot-source'
        $appDataEnv = Join-Path $root 'roaming'
        $config = Join-Path $appDataEnv 'com.orbita.app'
        $data = Join-Path $root 'user-data'
        $fixtureHomePath = Join-Path $root 'home'
        foreach ($dir in @($config, $data, $fixtureHomePath)) { [void][System.IO.Directory]::CreateDirectory($dir) }
        [System.IO.File]::WriteAllText((Join-Path $config 'bootstrap.json'), (@{ data_dir = $data } | ConvertTo-Json -Compress))
        [System.IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{}')
        $oldAppData = $env:APPDATA; $oldUserProfile = $env:USERPROFILE; $oldHome = $env:HOME
        $env:APPDATA = $appDataEnv; $env:USERPROFILE = $fixtureHomePath; $env:HOME = $fixtureHomePath
        $before = Get-TreeDigest $root
        try { $dotSourceOutput = @(. $script:RepairScript) }
        finally { $env:APPDATA = $oldAppData; $env:USERPROFILE = $oldUserProfile; $env:HOME = $oldHome }
        Assert-True ($dotSourceOutput.Count -eq 0) 'Dot-sourcing executed the entrypoint.'
        Assert-True ($before -eq (Get-TreeDigest $root)) 'Dot-sourcing changed the fixture.'
        Assert-True ($null -ne (Get-Command Invoke-GarminGateRepair -ErrorAction SilentlyContinue)) 'Public function was not loaded.'
    }

    Invoke-Check 'default inspection and InspectOnly are zero-write even when Orbita is mocked running' {
        $f = New-GarminFixture (Join-Path $tempRoot 'inspect')
        $before = Get-TreeDigest $f.Root
        $script:MockProcessMode = 'orbita'
        $default = Invoke-Repair $f
        $explicit = Invoke-Repair $f -InspectOnly
        $script:MockProcessMode = 'none'
        Assert-True ($default.mode -eq 'inspect' -and $explicit.mode -eq 'inspect') 'Expected inspect result.'
        Assert-True ($before -eq (Get-TreeDigest $f.Root)) 'Inspection wrote to the fixture.'
    }

    Invoke-Check 'explicit initialize writes schema v1 open generation 1 and marker' {
        $f = New-GarminFixture (Join-Path $tempRoot 'success')
        $result = Invoke-Repair $f -Initialize
        $gatePath = Join-Path $f.Config 'garmin_rate_limit_gate.v1'
        $markerPath = Join-Path $f.Config 'garmin_rate_limit_gate.initialized'
        $gate = Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
        Assert-True ($result.initialized -and $result.state -eq 'open' -and $result.generation -eq 1) 'Wrong result.'
        Assert-True ($gate.schemaVersion -eq 1 -and $gate.state -eq 'open' -and $gate.generation -eq 1) 'Wrong gate payload.'
        Assert-True ((Get-Content -LiteralPath $markerPath -Raw) -eq "initialized`n") 'Wrong marker content.'
        Assert-True (@(Get-ChildItem -LiteralPath $f.Config -Filter '*.tmp' -Force).Count -eq 0) 'Temporary gate file leaked.'
    }

    foreach ($state in @('open', 'closed', 'corrupt')) {
        Invoke-Check "existing $state gate is never overwritten" {
            $f = New-GarminFixture (Join-Path $tempRoot "existing-gate-$state")
            $gatePath = Join-Path $f.Config 'garmin_rate_limit_gate.v1'
            $bytes = if ($state -eq 'corrupt') { '{broken' } else { "original-$state" }
            [System.IO.File]::WriteAllText($gatePath, $bytes)
            $before = Get-TreeDigest $f.Root
            Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Existing gate was accepted.'
            Assert-True ($before -eq (Get-TreeDigest $f.Root)) 'Existing gate case changed files.'
        }
    }

    Invoke-Check 'existing marker blocks initialization without overwrite' {
        $f = New-GarminFixture (Join-Path $tempRoot 'existing-marker')
        $path = Join-Path $f.Config 'garmin_rate_limit_gate.initialized'
        [System.IO.File]::WriteAllText($path, 'preserve-me')
        $before = Get-TreeDigest $f.Root
        Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Existing marker was accepted.'
        Assert-True ($before -eq (Get-TreeDigest $f.Root)) 'Existing marker was changed.'
    }

    Invoke-Check 'missing or malformed bootstrap/settings and relative paths are rejected' {
        foreach ($kind in @('missing-bootstrap', 'bad-bootstrap', 'missing-settings', 'bad-settings', 'relative-data')) {
            $f = New-GarminFixture (Join-Path $tempRoot "invalid-$kind")
            $bootstrapPath = Join-Path $f.AppData 'bootstrap.json'
            $settingsPath = Join-Path $f.Data 'settings.json'
            switch ($kind) {
                'missing-bootstrap' { Remove-Item -LiteralPath $bootstrapPath }
                'bad-bootstrap' { [System.IO.File]::WriteAllText($bootstrapPath, '{') }
                'missing-settings' { Remove-Item -LiteralPath $settingsPath }
                'bad-settings' { [System.IO.File]::WriteAllText($settingsPath, '{') }
                'relative-data' { [System.IO.File]::WriteAllText($bootstrapPath, '{"data_dir":"relative\\data"}') }
            }
            Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } "$kind was accepted."
            Assert-True (-not (Test-Path (Join-Path $f.Config 'garmin_rate_limit_gate.initialized'))) "$kind wrote a marker."
        }
    }

    Invoke-Check 'relative tokenDir and settings read denial are rejected before any write' {
        $relative = New-GarminFixture (Join-Path $tempRoot 'relative-token')
        [System.IO.File]::WriteAllText((Join-Path $relative.Data 'settings.json'), '{"integrations":{"garmin":{"tokenDir":"relative-token-dir"}}}')
        Assert-Throws { Invoke-Repair $relative -Initialize | Out-Null } 'Relative tokenDir was accepted.'
        Assert-True (-not (Test-Path (Join-Path $relative.Config 'garmin_rate_limit_gate.initialized'))) 'Relative tokenDir wrote a marker.'

        $denied = New-GarminFixture (Join-Path $tempRoot 'settings-read-denied')
        $settingsPath = Join-Path $denied.Data 'settings.json'
        $exclusive = [System.IO.FileStream]::new($settingsPath, [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        try {
            Assert-Throws { Invoke-Repair $denied -Initialize | Out-Null } 'Settings read denial was accepted.'
            Assert-True (-not (Test-Path (Join-Path $denied.Config 'garmin_rate_limit_gate.initialized'))) 'Settings read failure wrote a marker.'
        } finally { $exclusive.Dispose() }
    }

    Invoke-Check 'reparse point roots and bootstrap data paths are rejected' {
        $f = New-GarminFixture (Join-Path $tempRoot 'reparse')
        $alias = Join-Path $tempRoot 'data-link'
        try { New-Item -ItemType Junction -Path $alias -Target $f.Data | Out-Null }
        catch { throw 'Could not create a synthetic junction for this check.' }
        $script:FixtureJunctionPaths.Add($alias)
        [System.IO.File]::WriteAllText((Join-Path $f.AppData 'bootstrap.json'), (@{ data_dir = $alias } | ConvertTo-Json -Compress))
        Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Reparse data path was accepted.'
        Assert-True (-not (Test-Path (Join-Path $f.Config 'garmin_rate_limit_gate.initialized'))) 'Reparse rejection wrote a marker.'
    }

    foreach ($where in @('default', 'custom', 'legacy')) {
        foreach ($record in @('expired', 'corrupt')) {
            Invoke-Check "old $where cooldown ($record) blocks initialization" {
                $f = New-GarminFixture (Join-Path $tempRoot "cooldown-$where-$record")
                $dir = switch ($where) {
                    'default' { Join-Path $f.Data 'garmin' }
                    'custom' {
                        $custom = Join-Path $f.Root 'custom-token-dir'
                        [void][System.IO.Directory]::CreateDirectory($custom)
                        [System.IO.File]::WriteAllText((Join-Path $f.Data 'settings.json'), (@{ integrations = @{ garmin = @{ tokenDir = $custom } } } | ConvertTo-Json -Depth 8 -Compress))
                        $custom
                    }
                    'legacy' { Join-Path $f.Home '.garminconnect' }
                }
                [void][System.IO.Directory]::CreateDirectory($dir)
                $recordPath = Join-Path $dir 'garmin_rate_limit.json'
                $contents = if ($record -eq 'corrupt') { '{bad' } else { '{"cooldownUntilUtc":"2000-01-01T00:00:00Z"}' }
                [System.IO.File]::WriteAllText($recordPath, $contents)
                Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Old cooldown evidence was ignored.'
                Assert-True ((Get-Content -LiteralPath $recordPath -Raw) -eq $contents) 'Cooldown evidence was modified.'
            }
        }
    }

    Invoke-Check 'mocked process guard permits no process, rejects Orbita, and fails closed on errors' {
        $f = New-GarminFixture (Join-Path $tempRoot 'process-guard')
        $script:MockProcessMode = 'none'
        [void](Invoke-Repair $f -InspectOnly)
        $script:MockProcessMode = 'orbita'
        Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Running Orbita was accepted.'
        Assert-True (-not (Test-Path (Join-Path $f.Config 'garmin_rate_limit_gate.initialized'))) 'Running-process rejection wrote a marker.'
        $script:MockProcessMode = 'error'
        Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Process enumeration failure was accepted.'
        $script:MockProcessMode = 'none'
        $result = Invoke-Repair $f -Initialize
        Assert-True $result.initialized 'No-process fixture failed.'
    }

    Invoke-Check 'OS byte-range lock rejects a competing holder' {
        $f = New-GarminFixture (Join-Path $tempRoot 'lock')
        $lockPath = Join-Path $f.Config 'garmin_rate_limit_gate.lock'
        $holder = [System.IO.FileStream]::new($lockPath, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
        try {
            $holder.Lock(0, 1)
            Assert-Throws { Enter-GarminRepairLock $lockPath | Out-Null } 'Competing lock was acquired.'
        } finally {
            try { $holder.Unlock(0, 1) } finally { $holder.Dispose() }
        }
    }

    Invoke-Check 'marker is durable before gate failure and retry is blocked' {
        $f = New-GarminFixture (Join-Path $tempRoot 'partial-write')
        $original = (Get-Command Test-GarminPathState -CommandType Function).ScriptBlock
        $script:GatePathForFault = Join-Path $f.Config 'garmin_rate_limit_gate.v1'
        $script:GateChecks = 0
        try {
            function Test-GarminPathState {
                param([string]$Path)
                if ($Path -eq $script:GatePathForFault) {
                    $script:GateChecks++
                    if ($script:GateChecks -ge 3) {
                        [void][System.IO.Directory]::CreateDirectory($Path)
                        return 'Present'
                    }
                    return 'Missing'
                }
                & $script:OriginalPathState $Path
            }
            $script:OriginalPathState = $original
            Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Injected gate race did not fail.'
            $marker = Join-Path $f.Config 'garmin_rate_limit_gate.initialized'
            Assert-True (Test-Path $marker) 'Marker was not retained after gate failure.'
            Assert-Throws { Invoke-Repair $f -Initialize | Out-Null } 'Retry after partial write was accepted.'
        } finally {
            Set-Item Function:Test-GarminPathState $original
            Remove-Variable GatePathForFault, GateChecks, OriginalPathState -Scope Script -ErrorAction SilentlyContinue
        }
    }

    Invoke-Check 'inspection never changes existing lock/config files' {
        $f = New-GarminFixture (Join-Path $tempRoot 'inspect-lock')
        $lock = Join-Path $f.Config 'garmin_rate_limit_gate.lock'
        [System.IO.File]::WriteAllText($lock, 'existing-lock')
        $before = Get-TreeDigest $f.Root
        [void](Invoke-Repair $f -InspectOnly)
        Assert-True ($before -eq (Get-TreeDigest $f.Root)) 'InspectOnly modified configuration.'
    }
} finally {
    $trimChars = [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot).TrimEnd($trimChars)
    $resolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd($trimChars)
    $tempPrefix = $resolvedTempBase + [System.IO.Path]::DirectorySeparatorChar
    $leaf = [System.IO.Path]::GetFileName($resolvedTempRoot)
    if (-not $resolvedTempRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $leaf -notmatch '^orbita-garmin-gate-tests-[0-9a-f]{32}$') {
        throw 'Refusing to remove an unverified test temp directory.'
    }
    foreach ($junctionPath in $script:FixtureJunctionPaths) {
        $resolvedJunction = [System.IO.Path]::GetFullPath($junctionPath)
        if (-not $resolvedJunction.StartsWith($resolvedTempRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to remove a junction outside the verified test temp directory.'
        }
        if ([System.IO.Directory]::Exists($resolvedJunction) -and
            (([System.IO.File]::GetAttributes($resolvedJunction) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
            [System.IO.Directory]::Delete($resolvedJunction, $false)
        }
    }
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`n$script:Passed passed; $script:Failed failed."
if ($script:Failed -gt 0) { exit 1 }
