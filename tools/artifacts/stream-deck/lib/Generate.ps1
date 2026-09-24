<#
    Profile generation.

    Builds a complete .sdProfile bundle from the merged spec model and installs
    it atomically: everything is written to a temporary directory first, and the
    live bundle is only replaced once the whole tree is on disk.

    Verified 2026-09-24 against Stream Deck 7.4.2: the app loads a bundle it did
    not create, provided the Device block matches a device it knows about, and
    it rewrites the bundle manifest byte-identically - so the output shape below
    is exactly what the app expects.
#>

Set-StrictMode -Version Latest

function Get-StreamDeckProfilesRoot {
    [CmdletBinding()] param()
    $root = Join-Path $env:APPDATA 'Elgato\StreamDeck\ProfilesV3'
    if (-not (Test-Path -LiteralPath $root)) {
        throw "Stream Deck profiles folder not found: $root. Is the Stream Deck app installed and run at least once?"
    }
    return $root
}

function Assert-StreamDeckClosed {
    <#
        The app holds every profile in memory and rewrites it on exit, silently
        discarding external edits. Refuse rather than race it.
    #>
    [CmdletBinding()] param()
    $p = Get-Process -Name 'StreamDeck' -ErrorAction SilentlyContinue
    if ($p) {
        throw 'The Stream Deck app is running. Close it first - it overwrites profile files on exit, which would discard everything this tool writes.'
    }
}

function Get-ProfileBundles {
    <# name -> @{ Dir; Guid; Device } for every bundle on this machine. #>
    [CmdletBinding()] param([string]$ProfilesRoot)
    $out = @{}
    foreach ($d in Get-ChildItem -LiteralPath $ProfilesRoot -Directory -Filter '*.sdProfile' -ErrorAction SilentlyContinue) {
        $mf = Join-Path $d.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $mf)) { continue }
        try { $j = Get-Content -LiteralPath $mf -Raw | ConvertFrom-Json } catch { continue }
        $name = Get-SpecProperty $j 'Name'
        if (-not $name) { continue }
        $out[$name] = @{
            Dir    = $d.FullName
            Guid   = ($d.Name -replace '\.sdProfile$', '')
            Device = Get-SpecProperty $j 'Device'
        }
    }
    return $out
}

function Resolve-DeviceBlock {
    <#
        The bundle binds to a physical device serial, which cannot be invented.
        It is recoverable though: the app writes a bundle per device on first
        run, so the serial is read from whatever bundle already exists.

        Prefers the target profile's own device (regenerating in place), then
        any other bundle. Errors actionably if the app has never seen a device.
    #>
    [CmdletBinding()] param([hashtable]$Bundles, [string]$ProfileName, [string]$PreferModel)

    if ($Bundles.ContainsKey($ProfileName) -and $Bundles[$ProfileName].Device) {
        return $Bundles[$ProfileName].Device
    }

    $candidates = @($Bundles.Values | Where-Object { $_.Device })
    if ($PreferModel) {
        $match = @($candidates | Where-Object { (Get-SpecProperty $_.Device 'Model') -eq $PreferModel })
        if ($match.Count -gt 0) { return $match[0].Device }
    }
    if ($candidates.Count -gt 0) { return $candidates[0].Device }

    throw ('No Stream Deck device block found. Open the Stream Deck app once with the device ' +
           'connected so it creates a profile, then re-run - the device serial cannot be synthesised.')
}

function Get-DeckFontSize {
    <# Title width -> font size, in the app's 72px-key units. #>
    [CmdletBinding()] param([string]$Title)
    if ($null -eq $Title) { return 13 }
    if ($Title.Length -le 6)  { return 13 }
    if ($Title.Length -le 9)  { return 12 }
    if ($Title.Length -le 12) { return 11 }
    return 10
}

function New-DeckState {
    [CmdletBinding()] param([string]$Title, [string]$ImageRelPath)
    return [ordered]@{
        FontFamily = ''; FontSize = (Get-DeckFontSize $Title); FontStyle = ''
        FontUnderline = $false; Image = $ImageRelPath; OutlineThickness = 2
        ShowTitle = $true; Title = $Title; TitleAlignment = 'bottom'; TitleColor = '#ffffff'
    }
}

function Build-DeckProfile {
    <#
        Produces the full bundle in a staging directory and returns its path.
        Nothing under ProfilesV3 is touched here.
    #>
    [CmdletBinding()] param(
        [Parameter(Mandatory)]$Model,
        [Parameter(Mandatory)][hashtable]$Context,
        [Parameter(Mandatory)][string]$StagingDir,
        [Parameter(Mandatory)]$Device
    )

    $profileGuid = Get-ProfileGuid -ProfileName $Model.ProfileName
    $bundleDir   = Join-Path $StagingDir "$profileGuid.sdProfile"
    $pagesDir    = Join-Path $bundleDir 'Profiles'
    New-Item -ItemType Directory -Path $pagesDir -Force | Out-Null

    # Children indexed by parent page, so folder keys can be synthesised.
    $childrenOf = @{}
    foreach ($pageId in $Model.Pages.Keys) {
        $page = $Model.Pages[$pageId]
        if (-not $page.Folder) { continue }
        $parent = Get-SpecProperty $page.Folder 'parent' $Model.RootPageId
        if (-not $childrenOf.ContainsKey($parent)) { $childrenOf[$parent] = @() }
        $childrenOf[$parent] += $pageId
    }

    $stats = @{ Pages = 0; Keys = 0; Icons = 0 }

    foreach ($pageId in $Model.Pages.Keys) {
        $page      = $Model.Pages[$pageId]
        $pageGuid  = $Context.PageGuids[$pageId]
        $pageDir   = Join-Path $pagesDir $pageGuid.ToUpperInvariant()
        $imagesDir = Join-Path $pageDir 'Images'
        New-Item -ItemType Directory -Path $imagesDir -Force | Out-Null

        $actions = [ordered]@{}

        # 1. Keys the pack declared.
        foreach ($coord in $page.Keys.Keys) {
            $key = $page.Keys[$coord]
            $actions[$coord] = New-DeckKey -Coord $coord -Key $key -Page $page `
                -Model $Model -Context $Context -ImagesDir $imagesDir -Stats $stats
            $stats.Keys++
        }

        # 2. Folder keys for child pages that are actually present.
        foreach ($childId in @($childrenOf[$pageId])) {
            if (-not $childId) { continue }
            $child = $Model.Pages[$childId]
            $slot  = Get-SpecProperty $child.Folder 'slot'
            if ($actions.Contains($slot)) {
                throw "Page '$pageId' already defines a key at [$slot]; pack '$($child.Pack)' also wants it for its folder key."
            }
            $synthetic = [pscustomobject]@{
                title  = Get-SpecProperty $child.Folder 'title' $child.Label
                icon   = Get-SpecProperty $child.Folder 'icon' ([pscustomobject]@{ glyph = 'folder' })
                accent = Get-SpecProperty $child.Folder 'accent' $child.Accent
                action = [pscustomobject]@{ type = 'folder'; page = $childId }
            }
            # The folder key's icon belongs to the CHILD's pack, not the parent's.
            $actions[$slot] = New-DeckKey -Coord $slot -Key $synthetic -Page $page `
                -Model $Model -Context $Context -ImagesDir $imagesDir -Stats $stats `
                -PackDirOverride $child.PackDir
            $stats.Keys++
        }

        # 3. Back key on every non-root page, unless the pack claimed the slot.
        if ($page.Folder) {
            $backSlot = $page.BackSlot
            if (-not $actions.Contains($backSlot)) {
                $synthetic = [pscustomobject]@{
                    title  = 'Back'
                    icon   = [pscustomobject]@{ glyph = 'arrow-left' }
                    accent = 'nav'
                    action = [pscustomobject]@{ type = 'back' }
                }
                $actions[$backSlot] = New-DeckKey -Coord $backSlot -Key $synthetic -Page $page `
                    -Model $Model -Context $Context -ImagesDir $imagesDir -Stats $stats
                $stats.Keys++
            }
        }

        $pageManifest = [ordered]@{
            Controllers = @([ordered]@{ Actions = $actions; Type = 'Keypad' })
            Icon        = ''
            Name        = ''
        }
        Set-Content -LiteralPath (Join-Path $pageDir 'manifest.json') `
            -Value ($pageManifest | ConvertTo-Json -Depth 20 -Compress) -NoNewline -Encoding utf8
        $stats.Pages++
    }

    # Bundle manifest. Pages.Pages lists only top-level pages; child folder pages
    # are reachable through their openchild actions and must not appear here.
    $rootGuid = $Context.PageGuids[$Model.RootPageId]
    $bundleManifest = [ordered]@{
        AppIdentifier = '*'
        Device        = $Device
        Name          = $Model.ProfileName
        Pages         = [ordered]@{
            Current = $rootGuid
            Default = $rootGuid
            Pages   = @($rootGuid)
        }
        Version       = '3.0'
    }
    Set-Content -LiteralPath (Join-Path $bundleDir 'manifest.json') `
        -Value ($bundleManifest | ConvertTo-Json -Depth 20 -Compress) -NoNewline -Encoding utf8

    return @{ BundleDir = $bundleDir; Guid = $profileGuid; Stats = $stats }
}

function New-DeckKey {
    <# Builds one action complete with its rendered States array. #>
    [CmdletBinding()] param(
        [string]$Coord, $Key, $Page, $Model, [hashtable]$Context,
        [string]$ImagesDir, [hashtable]$Stats, [string]$PackDirOverride
    )

    $actionSpec = Get-SpecProperty $Key 'action'
    if (-not $actionSpec) { throw "Key [$Coord] on page '$($Page.Id)' has no 'action'." }

    # Relative icon and script paths resolve against the pack that declared the
    # key, which is not always the pack that owns the page.
    $packDir = if ($PackDirOverride) { $PackDirOverride }
               elseif ($Page.KeyPacks.ContainsKey($Coord)) { $Page.KeyPacks[$Coord].PackDir }
               else { $Page.PackDir }

    # ActionIDs are derived rather than hand-maintained. The app tolerates
    # duplicates and even all-zero ids, but deterministic ids keep regeneration
    # a no-op from the app's point of view.
    $actionId = (New-UuidV5 -Name "action:$($Model.ProfileName)/$($Page.Id)/$Coord").ToString()

    $keyContext = $Context.Clone()
    $keyContext.PackDir = $packDir

    $action = New-DeckAction -Action $actionSpec -ActionId $actionId -Context $keyContext

    $title       = Get-SpecProperty $Key 'title' ''
    $accent      = Get-SpecProperty $Key 'accent' $Page.Accent
    $muted       = [bool](Get-SpecProperty $Key 'unconfigured' $false)
    $safe        = ($title -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
    if ([string]::IsNullOrEmpty($safe)) { $safe = 'key' }
    $coordPart   = $Coord -replace ',', '_'

    $states = @(Get-SpecProperty $Key 'states' @())
    if ($states.Count -gt 0) {
        $built = @()
        for ($i = 0; $i -lt $states.Count; $i++) {
            $s        = $states[$i]
            $sTitle   = Get-SpecProperty $s 'title' $title
            $sAccent  = Get-SpecProperty $s 'accent' $accent
            $sIcon    = Get-SpecProperty $s 'icon' (Get-SpecProperty $Key 'icon')
            $fileName = "$safe-${coordPart}_s$i.png"
            Render-DeckIcon -Icon $sIcon -Accent $sAccent -Muted $false `
                -PackDir $packDir -Context $Context -OutPath (Join-Path $ImagesDir $fileName)
            $built += New-DeckState -Title $sTitle -ImageRelPath "Images/$fileName"
            $Stats.Icons++
        }
        $action.States = $built
    } else {
        $fileName = "$safe-$coordPart.png"
        Render-DeckIcon -Icon (Get-SpecProperty $Key 'icon') -Accent $accent -Muted $muted `
            -PackDir $packDir -Context $Context -OutPath (Join-Path $ImagesDir $fileName)
        $action.States = @(New-DeckState -Title $title -ImageRelPath "Images/$fileName")
        $Stats.Icons++
    }

    return $action
}

function Install-DeckProfile {
    <#
        Swaps the staged bundle into ProfilesV3. Backs up the existing bundle
        first and restores it if the swap fails partway.
    #>
    [CmdletBinding()] param(
        [Parameter(Mandatory)][string]$StagedBundleDir,
        [Parameter(Mandatory)][string]$ProfilesRoot,
        [Parameter(Mandatory)][string]$Guid,
        [string]$BackupDir
    )

    $target = Join-Path $ProfilesRoot "$Guid.sdProfile"
    $rollback = $null

    if (Test-Path -LiteralPath $target) {
        $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
        $rollback = Join-Path ([string]::IsNullOrWhiteSpace($BackupDir) ? $env:TEMP : $BackupDir) `
                              "StreamDeck-$Guid-backup-$stamp"
        Copy-Item -LiteralPath $target -Destination $rollback -Recurse -Force
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    try {
        Move-Item -LiteralPath $StagedBundleDir -Destination $target -Force
    } catch {
        if ($rollback -and (Test-Path -LiteralPath $rollback)) {
            Copy-Item -LiteralPath $rollback -Destination $target -Recurse -Force
        }
        throw
    }

    return @{ Target = $target; Backup = $rollback }
}
