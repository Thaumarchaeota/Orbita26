<#
Explicit, offline repair for an older installation with no global Garmin gate.
Run without switches to inspect; use -Initialize only after reviewing that result.
Dot-sourcing defines functions without running the repair.
#>
[CmdletBinding()]
param(
    [switch]$InspectOnly,
    [switch]$Initialize,
    [string]$AppConfigRoot,
    [string]$AppDataRoot,
    [string]$LegacyHomeRoot
)

function Assert-GarminAbsolutePath {
    param([string]$Value, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label is missing." }
    # IsPathRooted accepts drive-relative C:foo; those paths depend on process state.
    if ($Value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+[\\/]?)') {
        throw "$Label must be an absolute path."
    }
    try { return [System.IO.Path]::GetFullPath($Value) }
    catch { throw "$Label is invalid." }
}

function Test-GarminPathState {
    param([string]$Path)
    $full = Assert-GarminAbsolutePath $Path 'Path'
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $root
    try {
        $rootAttrs = [System.IO.File]::GetAttributes($root)
        if (($rootAttrs -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'A reparse path is not allowed.'
        }
    } catch { throw 'A path could not be inspected safely.' }
    $parts = $full.Substring($root.Length).TrimEnd('\', '/').Split([char[]]@('\','/'), [System.StringSplitOptions]::RemoveEmptyEntries)
    $missing = $false
    foreach ($part in $parts) {
        $cursor = [System.IO.Path]::Combine($cursor, $part)
        if ($missing) { continue }
        try {
            $attrs = [System.IO.File]::GetAttributes($cursor)
            if (($attrs -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'A reparse path is not allowed.'
            }
        } catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
            $missing = $true
        } catch {
            if ($_.Exception.Message -eq 'A reparse path is not allowed.') { throw }
            throw 'A path could not be inspected safely.'
        }
    }
    if ($missing) { return 'Missing' }
    return 'Present'
}

function Read-GarminJsonObject {
    param([string]$Path, [string]$Label)
    if ((Test-GarminPathState $Path) -ne 'Present') { throw "$Label is missing." }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false, $true))
        $value = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        if ($null -eq $value -or $value -isnot [pscustomobject]) { throw 'Invalid JSON object.' }
        return $value
    } catch { throw "$Label could not be parsed safely." }
}

function Get-GarminRepairContext {
    param([string]$ConfigRoot, [string]$DataRoot, [string]$HomeRoot)
    $ErrorActionPreference = 'Stop'
    $config = Assert-GarminAbsolutePath $ConfigRoot 'AppConfigRoot'
    $data = Assert-GarminAbsolutePath $DataRoot 'AppDataRoot'
    $legacyHomePath = Assert-GarminAbsolutePath $HomeRoot 'LegacyHomeRoot'
    foreach ($root in @($config, $data, $legacyHomePath)) {
        if ((Test-GarminPathState $root) -ne 'Present') { throw 'A required root is missing.' }
        if (-not [System.IO.Directory]::Exists($root)) { throw 'A required root is not a directory.' }
    }

    $bootstrap = Read-GarminJsonObject ([System.IO.Path]::Combine($data, 'bootstrap.json')) 'Bootstrap'
    $dataDirValue = $null
    if ($bootstrap.PSObject.Properties['data_dir']) { $dataDirValue = $bootstrap.data_dir }
    elseif ($bootstrap.PSObject.Properties['dataDir']) { $dataDirValue = $bootstrap.dataDir }
    if ($dataDirValue -isnot [string]) { throw 'Bootstrap data directory is invalid.' }
    $dataDir = Assert-GarminAbsolutePath $dataDirValue 'Bootstrap data directory'
    if ((Test-GarminPathState $dataDir) -ne 'Present' -or -not [System.IO.Directory]::Exists($dataDir)) {
        throw 'Bootstrap data directory is unavailable.'
    }

    $settings = Read-GarminJsonObject ([System.IO.Path]::Combine($dataDir, 'settings.json')) 'Settings'
    $custom = ''
    if ($settings.PSObject.Properties['integrations']) {
        if ($settings.integrations -isnot [pscustomobject]) { throw 'Garmin settings are invalid.' }
        if ($settings.integrations.PSObject.Properties['garmin']) {
            if ($settings.integrations.garmin -isnot [pscustomobject]) { throw 'Garmin settings are invalid.' }
            if ($settings.integrations.garmin.PSObject.Properties['tokenDir']) {
                if ($settings.integrations.garmin.tokenDir -isnot [string]) { throw 'Garmin token directory is invalid.' }
                $custom = $settings.integrations.garmin.tokenDir.Trim()
            }
        }
    }
    $defaultTokenDir = [System.IO.Path]::Combine($dataDir, 'garmin')
    $customTokenDir = if ($custom.Length -gt 0) { Assert-GarminAbsolutePath $custom 'Garmin token directory' } else { $defaultTokenDir }
    $legacyTokenDir = [System.IO.Path]::Combine($legacyHomePath, '.garminconnect')

    # docs/specs/garmin-sync-workflow.proposed.md §20.3: this is the approved manual
    # initialization exception; old cooldown evidence must never be inferred away.
    foreach ($dir in @($defaultTokenDir, $customTokenDir, $legacyTokenDir)) {
        $cooldown = [System.IO.Path]::Combine($dir, 'garmin_rate_limit.json')
        if ((Test-GarminPathState $cooldown) -ne 'Missing') { throw 'An old Garmin cooldown record exists.' }
    }
    $gate = [System.IO.Path]::Combine($config, 'garmin_rate_limit_gate.v1')
    $marker = [System.IO.Path]::Combine($config, 'garmin_rate_limit_gate.initialized')
    if ((Test-GarminPathState $gate) -ne 'Missing' -or (Test-GarminPathState $marker) -ne 'Missing') {
        throw 'Garmin gate or initialization marker already exists.'
    }
    return [pscustomobject]@{ Config = $config; Gate = $gate; Marker = $marker }
}

function Assert-GarminStopped {
    try { $running = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'orbita' }) }
    catch { throw 'Orbita process state could not be verified.' }
    if ($running.Count -gt 0) { throw 'Orbita must be closed before initialization.' }
}

function Enter-GarminRepairLock {
    param([string]$Path)
    if ((Test-GarminPathState $Path) -eq 'Present' -and [System.IO.Directory]::Exists($Path)) {
        throw 'A Garmin lock path is invalid.'
    }
    $file = $null
    try {
        $file = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
        $file.Lock(0, 1)
        return $file
    } catch {
        if ($null -ne $file) { $file.Dispose() }
        throw 'A Garmin lock could not be acquired.'
    }
}

function Invoke-GarminGateRepair {
    [CmdletBinding()]
    param([switch]$InspectOnly, [switch]$Initialize, [string]$AppConfigRoot,
          [string]$AppDataRoot, [string]$LegacyHomeRoot)
    $ErrorActionPreference = 'Stop'
    if ($InspectOnly -and $Initialize) { throw 'Choose inspection or initialization.' }
    $appBase = if ($AppConfigRoot) { $AppConfigRoot } elseif ($env:APPDATA) {
        [System.IO.Path]::Combine($env:APPDATA, 'com.orbita.app')
    } else { throw 'APPDATA is unavailable.' }
    $dataBase = if ($AppDataRoot) { $AppDataRoot } else { $appBase }
    $homeBase = if ($LegacyHomeRoot) { $LegacyHomeRoot } elseif ($env:USERPROFILE) {
        $env:USERPROFILE
    } elseif ($env:HOME) { $env:HOME } else { throw 'Home directory is unavailable.' }

    $context = Get-GarminRepairContext $appBase $dataBase $homeBase
    if (-not $Initialize) {
        return [pscustomobject]@{ mode = 'inspect'; eligible = $true; gate = 'missing'; marker = 'missing' }
    }
    Assert-GarminStopped
    $lane = $null
    $gateLock = $null
    try {
        $lane = Enter-GarminRepairLock ([System.IO.Path]::Combine($context.Config, 'garmin_request_lane.lock'))
        $gateLock = Enter-GarminRepairLock ([System.IO.Path]::Combine($context.Config, 'garmin_rate_limit_gate.lock'))
        Assert-GarminStopped
        $context = Get-GarminRepairContext $appBase $dataBase $homeBase

        # Marker first: if gate creation fails, a later run remains closed_unknown.
        # This reverses first-install ordering because a legacy repair must fail closed.
        $markerFile = $null
        try {
            $markerFile = [System.IO.FileStream]::new($context.Marker, [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $bytes = [System.Text.Encoding]::ASCII.GetBytes("initialized`n")
            $markerFile.Write($bytes, 0, $bytes.Length)
            $markerFile.Flush($true)
        } catch { throw 'Initialization marker could not be persisted; inspect before retrying.' }
        finally { if ($null -ne $markerFile) { $markerFile.Dispose() } }

        $tmp = [System.IO.Path]::Combine($context.Config,
            'garmin_rate_limit_gate.v1.' + [guid]::NewGuid().ToString('N') + '.tmp')
        $payload = '{"schemaVersion":1,"state":"open","generation":1,"latchedAtUtc":null,"cooldownUntilUtc":null,"lastStatus":null,"releasedAtUtc":null}'
        $tmpFile = $null
        try {
            $tmpFile = [System.IO.FileStream]::new($tmp, [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($payload)
            $tmpFile.Write($bytes, 0, $bytes.Length)
            $tmpFile.Flush($true)
            $tmpFile.Dispose()
            $tmpFile = $null
            if ((Test-GarminPathState $context.Gate) -ne 'Missing') { throw 'Gate appeared during initialization.' }
            [System.IO.File]::Move($tmp, $context.Gate)
        } catch {
            throw 'Gate could not be persisted; marker remains and access stays closed_unknown.'
        } finally {
            if ($null -ne $tmpFile) { $tmpFile.Dispose() }
            try { if ([System.IO.File]::Exists($tmp)) { [System.IO.File]::Delete($tmp) } } catch { }
        }
        return [pscustomobject]@{ mode = 'initialize'; initialized = $true; state = 'open'; generation = 1 }
    } finally {
        try {
            if ($null -ne $gateLock) { $gateLock.Dispose() }
        } finally {
            if ($null -ne $lane) { $lane.Dispose() }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-GarminGateRepair -InspectOnly:$InspectOnly -Initialize:$Initialize `
        -AppConfigRoot $AppConfigRoot -AppDataRoot $AppDataRoot -LegacyHomeRoot $LegacyHomeRoot
}
