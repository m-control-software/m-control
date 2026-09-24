<#
    App resolution.

    Specs name an application ("vscode"); this file turns that into an absolute
    path on the current machine. That indirection is the whole portability fix:
    no spec ever stores C:\Users\<name>\... .

    Store apps need their own branch. C:\Program Files\WindowsApps denies
    directory enumeration to everyone including administrators, so a glob over
    Microsoft.ScreenSketch_*_x64__8wekyb3d8bbwe never matches even though
    Test-Path on the full path of the same file returns true. Such apps declare
    an "appx" block and are located through Get-AppxPackage instead.

    Generalised from the original Repair-StreamDeckPaths.ps1.
#>

Set-StrictMode -Version Latest

function Expand-AppPath {
    <# Expands %VAR% style environment references. #>
    [CmdletBinding()] param([string]$Path)
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Resolve-DeckAppx {
    <#
        Locates a Store app from its package family.

        Returns @{ Path; BundleId } or $null. Get-AppxPackage is a Windows
        PowerShell cmdlet; under pwsh it is either absent or fails, so every
        failure here falls through to the ordinary candidate list rather than
        aborting the run.
    #>
    [CmdletBinding()] param([Parameter(Mandatory)]$Appx)

    $package = Get-SpecProperty $Appx 'package'
    $exe     = Get-SpecProperty $Appx 'exe'
    $aumid   = Get-SpecProperty $Appx 'aumid'
    if (-not $package -or -not $exe) { return $null }

    try {
        $pkg = @(Get-AppxPackage -Name $package -ErrorAction Stop) |
               Sort-Object -Property Version -Descending | Select-Object -First 1
    } catch {
        return $null
    }
    if (-not $pkg -or -not $pkg.InstallLocation) { return $null }

    $full = Join-Path $pkg.InstallLocation $exe
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }

    return @{ Path = $full; BundleId = $aumid }
}

function Resolve-DeckApp {
    <#
        Resolves one app definition.

        Definition fields:
          appx       : { package, exe, aumid } for Store apps; tried first
          candidates : ordered list of absolute paths; may contain wildcards
          command    : bare command name to look up on PATH as a last resort

        Wildcard candidates resolve to the highest-sorting match, which picks
        the newest version for paths carrying a version number.

        Returns @{ Path; BundleId } - BundleId is $null for ordinary apps - or
        $null when nothing matches. Callers decide whether that is fatal.
    #>
    [CmdletBinding()] param([Parameter(Mandatory)]$Definition)

    $appx = Get-SpecProperty $Definition 'appx'
    if ($appx) {
        $hit = Resolve-DeckAppx -Appx $appx
        if ($hit) { return $hit }
    }

    foreach ($candidate in @(Get-SpecProperty $Definition 'candidates' @())) {
        $expanded = Expand-AppPath $candidate

        if ($expanded -match '[*?]') {
            # Not $matches: the -match above populates that automatic variable.
            $hits = @(Resolve-Path -Path $expanded -ErrorAction SilentlyContinue |
                      Sort-Object -Property Path -Descending)
            if ($hits.Count -gt 0) { return @{ Path = $hits[0].Path; BundleId = $null } }
            continue
        }

        if (Test-Path -LiteralPath $expanded -PathType Leaf) {
            return @{ Path = $expanded; BundleId = $null }
        }
    }

    $command = Get-SpecProperty $Definition 'command'
    if ($command) {
        $cmd = Get-Command $command -CommandType Application -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($cmd) { return @{ Path = $cmd.Source; BundleId = $null } }
    }

    return $null
}

function Resolve-DeckApps {
    <#
        Resolves every app declared across all packs.
        Returns @{ Resolved = @{id->path}; BundleIds = @{id->aumid}; Missing = @(id) }.
    #>
    [CmdletBinding()] param([Parameter(Mandatory)]$Model)

    $resolved  = @{}
    $bundleIds = @{}
    $missing   = [System.Collections.Generic.List[string]]::new()

    foreach ($id in $Model.Apps.Keys) {
        $hit = Resolve-DeckApp -Definition $Model.Apps[$id].Def
        if ($hit) {
            $resolved[$id] = $hit.Path
            if ($hit.BundleId) { $bundleIds[$id] = $hit.BundleId }
        } else {
            $missing.Add($id)
        }
    }

    return @{ Resolved = $resolved; BundleIds = $bundleIds; Missing = @($missing) }
}
