<#
    Test harness for Install-DeckProfile.

    Exercises the swap directly rather than through main.ps1, because a real
    install additionally requires the Stream Deck app to be closed - which a
    test cannot assume. Prints one JSON object describing the end state.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$WorkDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'lib\Generate.ps1')

$guid = '11111111-2222-3333-4444-555555555555'
$root = Join-Path $WorkDir 'root'
$backups = Join-Path $WorkDir 'backups'
New-Item -ItemType Directory -Path $root, $backups -Force | Out-Null

function New-StagedBundle {
    param([Parameter(Mandatory)][string]$Marker)
    $dir = Join-Path $WorkDir ('stage-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $dir 'manifest.json') -Value $Marker -NoNewline
    return $dir
}

function Get-InstalledMarker {
    $target = Join-Path $root "$guid.sdProfile"
    if (-not (Test-Path -LiteralPath $target)) { return $null }
    return (Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw).Trim()
}

function Get-AsideCount {
    return @(Get-ChildItem -LiteralPath $root -Directory -Filter "$guid.sdProfile.aside-*" -ErrorAction SilentlyContinue).Count
}

function Install-Marker {
    param([Parameter(Mandatory)][string]$Marker)
    return Install-DeckProfile -StagedBundleDir (New-StagedBundle $Marker) `
        -ProfilesRoot $root -Guid $guid -BackupDir $backups
}

$out = [ordered]@{}

switch ($Scenario) {
    'fresh' {
        $r = Install-Marker 'v1'
        $out.installed = Get-InstalledMarker
        $out.asides = Get-AsideCount
        $out.hasBackup = ($null -ne $r.Backup)
    }
    'replace' {
        Install-Marker 'v1' | Out-Null
        $r = Install-Marker 'v2'
        $out.installed = Get-InstalledMarker
        $out.asides = Get-AsideCount
        $out.backupMarker = (Get-Content -LiteralPath (Join-Path $r.Backup 'manifest.json') -Raw).Trim()
        # Backups must be siblings, never nested: a same-second stamp collision
        # used to make Copy-Item bury the newer bundle inside the older backup.
        $out.backupIsFlat = -not (Test-Path -LiteralPath (Join-Path $r.Backup "$guid.sdProfile"))
    }
    'recover-orphan' {
        Install-Marker 'v1' | Out-Null
        Install-Marker 'v2' | Out-Null
        # Simulate a kill landing between the two renames: the only copy of the
        # live bundle is sitting under its aside name.
        Move-Item -LiteralPath (Join-Path $root "$guid.sdProfile") `
            -Destination (Join-Path $root "$guid.sdProfile.aside-20200101-000000")
        $out.markerWhileCrashed = Get-InstalledMarker
        $out.asidesWhileCrashed = Get-AsideCount

        $r = Install-Marker 'v3'
        $out.installed = Get-InstalledMarker
        $out.asides = Get-AsideCount
        # Proof the orphan was recovered rather than discarded: it got backed up.
        $out.backupMarker = (Get-Content -LiteralPath (Join-Path $r.Backup 'manifest.json') -Raw).Trim()
    }
    'rollback' {
        Install-Marker 'v1' | Out-Null
        try {
            Install-DeckProfile -StagedBundleDir (Join-Path $WorkDir 'does-not-exist') `
                -ProfilesRoot $root -Guid $guid -BackupDir $backups | Out-Null
            $out.threw = $false
        } catch {
            $out.threw = $true
        }
        $out.installed = Get-InstalledMarker
        $out.asides = Get-AsideCount
    }
    default { throw "Unknown scenario '$Scenario'." }
}

$out | ConvertTo-Json -Compress
