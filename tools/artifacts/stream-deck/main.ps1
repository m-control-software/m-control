<#
    stream-deck: generates an Elgato Stream Deck profile from declarative specs.

    Tool Protocol v1: a single JSON ToolRequest is read from stdin to EOF before
    any work begins, and stdout carries NDJSON ToolEvent lines only.

    Usage (via mctl):
      mctl run stream-deck              generate and install
      mctl run stream-deck check=true   validate and report, write nothing

    Flags arrive as ToolInput key=value pairs, not as argv: mctl's parseArgs
    discards anything starting with '--', so a '--check' style flag would be
    silently dropped and the tool would install for real.

    Exit codes: 0 success, 1 recoverable failure, 2 unrecoverable failure.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($lib in 'Protocol', 'Uuid5', 'Spec', 'Actions', 'AppResolver', 'IconEngine', 'Render', 'Generate') {
    . (Join-Path $here "lib\$lib.ps1")
}

function Get-ConfigValue {
    <#
        RunContext.config is a flat map keyed by the manifest's requiredConfig
        entries. Both the fully-qualified and bare key are accepted so the tool
        keeps working if core's key shape is ever shortened.
    #>
    [CmdletBinding()] param($Config, [string]$Name, $Default = $null)
    foreach ($k in "stream-deck.$Name", $Name) {
        $v = Get-SpecProperty $Config $k
        if ($null -ne $v -and "$v" -ne '') { return $v }
    }
    return $Default
}

function ConvertTo-DeckBool {
    <#
        Parses a ToolInput flag. Values arrive as STRINGS, so a naive truthiness
        test would treat "false" as true - exactly the wrong direction for a
        safety flag that decides whether anything is written to disk.
    #>
    [CmdletBinding()] param($Value, [bool]$Default = $false)
    if ($null -eq $Value) { return $Default }
    if ($Value -is [bool]) { return $Value }

    switch ("$Value".Trim().ToLowerInvariant()) {
        ''      { return $Default }
        'true'  { return $true }
        '1'     { return $true }
        'yes'   { return $true }
        'on'    { return $true }
        'false' { return $false }
        '0'     { return $false }
        'no'    { return $false }
        'off'   { return $false }
        default {
            throw "Cannot interpret '$Value' as a boolean. Use check=true or check=false."
        }
    }
}

$exitCode = 0
try {
    $request = Read-ToolRequest

    # Not $input: that is a PowerShell automatic variable (the pipeline
    # enumerator) and assigning it would shadow the real one.
    $toolInput = Get-SpecProperty $request 'input'
    $checkOnly = ConvertTo-DeckBool (Get-SpecProperty $toolInput 'check') $false

    $context = Get-SpecProperty $request 'context'
    $config  = Get-SpecProperty $context 'config'

    Write-ToolStarted -Meta @{ mode = $(if ($checkOnly) { 'check' } else { 'generate' }) }

    # ---- 1. Locate packs -------------------------------------------------
    $packDirs = @(Get-ConfigValue $config 'packDirs' @())
    if ($packDirs.Count -eq 1 -and $packDirs[0] -is [string] -and $packDirs[0].Contains(';')) {
        $packDirs = $packDirs[0].Split(';')
    }
    $searchPath = @($here) + @($packDirs | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) })

    $specFiles = @(Find-DeckSpecFile -SearchPath $searchPath)
    if ($specFiles.Count -eq 0) {
        throw "No *.deck.json specs found. Searched: $($searchPath -join ', ')"
    }
    Write-ToolLog -Level 'info' -Message "Found $($specFiles.Count) spec file(s)." -Data @{ specs = $specFiles }

    $loaded = @($specFiles | ForEach-Object { Import-DeckSpec -Path $_ })
    $model  = Merge-DeckSpec -Loaded $loaded -ProfileNameOverride (Get-ConfigValue $config 'profileName')

    Write-ToolLog -Level 'info' -Message "Merged $($model.Packs.Count) pack(s) into profile '$($model.ProfileName)'." `
        -Data @{ packs = @($model.Packs.Keys); pages = @($model.Pages.Keys) }

    # ---- 2. Resolve the machine -----------------------------------------
    $apps = Resolve-DeckApps -Model $model
    if ($apps.Missing.Count -gt 0) {
        Write-ToolLog -Level 'warn' -Message 'Some apps could not be resolved on this machine.' `
            -Data @{ missing = $apps.Missing }
    }

    $profilesRoot = Get-StreamDeckProfilesRoot -Override (Get-ConfigValue $config 'profilesRoot')
    $bundles      = Get-ProfileBundles -ProfilesRoot $profilesRoot
    $device       = Resolve-DeviceBlock -Bundles $bundles -ProfileName $model.ProfileName `
                        -PreferModel (Get-ConfigValue $config 'deviceModel')

    # Sibling profiles are referenced by NAME, never by GUID, so hand-maintained
    # profiles keep their identity and are never regenerated or overwritten.
    $siblings = @{}
    foreach ($name in $bundles.Keys) { $siblings[$name] = $bundles[$name].Guid.ToLowerInvariant() }

    $pageGuids = @{}
    foreach ($pageId in $model.Pages.Keys) {
        $pageGuids[$pageId] = Get-PageGuid -ProfileName $model.ProfileName -PageId $pageId
    }

    $runContext = @{
        ResolvedApps    = $apps.Resolved
        AppBundleIds    = $apps.BundleIds
        MissingProfiles = [System.Collections.Generic.List[string]]::new()
        SiblingProfiles = $siblings
        PageGuids       = $pageGuids
        Plugins         = $model.Plugins
        Palette         = $model.Palette
        PackDir         = $here
    }

    # ---- 3. Build into staging ------------------------------------------
    if (-not $checkOnly) { Assert-StreamDeckClosed }

    $staging = Join-Path ([System.IO.Path]::GetTempPath()) "mctl-stream-deck-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    try {
        $built = Build-DeckProfile -Model $model -Context $runContext -StagingDir $staging -Device $device

        Write-ToolLog -Level 'info' -Message ("Built $($built.Stats.Pages) page(s), " +
            "$($built.Stats.Keys) key(s), $($built.Stats.Icons) icon(s).")

        $missingProfiles = @($runContext.MissingProfiles)
        if ($missingProfiles.Count -gt 0) {
            Write-ToolLog -Level 'warn' `
                -Message 'Some profile-switch keys point at profiles that do not exist here; they were left inert.' `
                -Data @{ missing = $missingProfiles }
        }

        if ($checkOnly) {
            Write-ToolResult -Payload ([ordered]@{
                mode = 'check'; ok = $true; profile = $model.ProfileName
                profileGuid = $built.Guid
                packs = @($model.Packs.Keys); pages = @($model.Pages.Keys)
                pageCount = $built.Stats.Pages; keyCount = $built.Stats.Keys
                missingApps = $apps.Missing
                missingProfiles = $missingProfiles
                installed = $false
            })
        } else {
            $installed = Install-DeckProfile -StagedBundleDir $built.BundleDir `
                -ProfilesRoot $profilesRoot -Guid $built.Guid `
                -BackupDir (Get-ConfigValue $config 'backupDir')

            Write-ToolResult -Payload ([ordered]@{
                mode = 'generate'; ok = $true; profile = $model.ProfileName
                profileGuid = $built.Guid; path = $installed.Target
                backup = $installed.Backup
                packs = @($model.Packs.Keys)
                pageCount = $built.Stats.Pages; keyCount = $built.Stats.Keys
                missingApps = $apps.Missing
                missingProfiles = $missingProfiles
                installed = $true
            })
        }
    } finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
catch {
    $exitCode = 1
    try {
        Write-ToolError -Message $_.Exception.Message -Code 'STREAM_DECK_FAILED' -Recoverable $true
    } catch {
        # Protocol emission itself failed - nothing left but a non-zero exit.
        $exitCode = 2
    }
}

exit $exitCode
