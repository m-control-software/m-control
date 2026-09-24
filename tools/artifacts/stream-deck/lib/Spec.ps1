<#
    Spec loading, pack discovery and merge.

    A "pack" is a directory containing one *.deck.json file plus the assets and
    scripts that spec refers to. Packs are discovered across every tools root
    and every explicitly configured pack directory, which is what lets a
    client-specific pack stay in place, outside any repository, and still
    contribute pages to the generated profile.

    Merge rules (see docs/adr/0010):
      - a pack that is absent is a complete no-op: its pages are not generated
        and the folder key that opens them is not generated either
      - two packs claiming the same folder slot on the same parent page is a
        hard error, never a silent overwrite
      - page ids are global and must be unique across packs
#>

Set-StrictMode -Version Latest

function Find-DeckSpecFile {
    <#
        Returns every *.deck.json under the given directories, one level deep
        plus a conventional specs\ subdirectory. Missing directories are skipped
        silently - that is the "pack absent" case, not an error.
    #>
    [CmdletBinding()] param([string[]]$SearchPath)

    $found = [System.Collections.Generic.List[string]]::new()
    foreach ($dir in $SearchPath) {
        if ([string]::IsNullOrWhiteSpace($dir)) { continue }
        if (-not (Test-Path -LiteralPath $dir)) { continue }

        foreach ($sub in @($dir, (Join-Path $dir 'specs'))) {
            if (-not (Test-Path -LiteralPath $sub)) { continue }
            Get-ChildItem -LiteralPath $sub -Filter '*.deck.json' -File -ErrorAction SilentlyContinue |
                ForEach-Object { $found.Add($_.FullName) }
        }
        # Tools roots nest packs one level deeper (tools/<category>/<id>/specs).
        Get-ChildItem -LiteralPath $dir -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'specs' } |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Filter '*.deck.json' -File -ErrorAction SilentlyContinue |
                    ForEach-Object { $found.Add($_.FullName) }
            }
    }
    return ($found | Sort-Object -Unique)
}

function Import-DeckSpec {
    <# Loads and shallow-validates one *.deck.json. #>
    [CmdletBinding()] param([Parameter(Mandatory)][string]$Path)

    try { $j = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "Invalid JSON in spec '$Path': $($_.Exception.Message)" }

    foreach ($required in 'specVersion', 'pack') {
        if ($null -eq $j.PSObject.Properties[$required]) {
            throw "Spec '$Path' is missing required field '$required'."
        }
    }
    if ($j.specVersion -ne 1) {
        throw "Spec '$Path' declares specVersion $($j.specVersion); this generator supports 1."
    }
    if ($j.pack -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
        throw "Spec '$Path' has pack id '$($j.pack)'; expected kebab-case."
    }

    return [pscustomobject]@{
        Path    = $Path
        PackDir = Split-Path -Parent $Path
        Spec    = $j
    }
}

function Get-SpecProperty {
    <#
        StrictMode-safe property read. ConvertFrom-Json produces PSCustomObject,
        where touching an absent property throws under Set-StrictMode.

        Indexes PSObject.Properties rather than enumerating .Name: under
        StrictMode, member enumeration over an object with NO properties throws
        "The property 'Name' cannot be found on this object". An empty JSON
        object is not an edge case here - it is what `mctl run <tool>` sends as
        ToolInput when no key=value pairs are given.
    #>
    [CmdletBinding()] param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }

    if ($Object -is [System.Collections.IDictionary]) {
        if (-not $Object.Contains($Name)) { return $Default }
        $dv = $Object[$Name]
        if ($null -eq $dv) { return $Default }
        return $dv
    }

    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value) { return $Default }
    return $prop.Value
}

function ConvertTo-Hashtable {
    <# PSCustomObject -> ordered hashtable, one level. #>
    [CmdletBinding()] param($Object)
    $h = [ordered]@{}
    if ($null -eq $Object) { return $h }
    foreach ($p in $Object.PSObject.Properties) { $h[$p.Name] = $p.Value }
    return $h
}

function Merge-DeckSpec {
    <#
        Folds N loaded packs into one model the generator can walk.

        Returns:
          ProfileName, RootPageId, Pages (ordered id -> page), Apps, Plugins,
          Palette, Requires, Packs, Device grid
    #>
    [CmdletBinding()] param(
        [Parameter(Mandatory)][object[]]$Loaded,
        [string]$ProfileNameOverride
    )

    $model = [ordered]@{
        ProfileName = $ProfileNameOverride
        RootPageId  = 'home'
        Pages       = [ordered]@{}
        Apps        = [ordered]@{}
        Plugins     = [ordered]@{}
        Palette     = [ordered]@{}
        Requires    = [ordered]@{ bin = @(); plugins = @() }
        Packs       = [ordered]@{}
        Columns     = 5
        Rows        = 3
    }

    # Deterministic order: the pack declaring `profile` first (the base), then
    # the rest alphabetically, so merge results never depend on disk order.
    $ordered = @($Loaded | Sort-Object `
        @{ Expression = { if (Get-SpecProperty $_.Spec 'profile') { 0 } else { 1 } } }, `
        @{ Expression = { $_.Spec.pack } })

    # Tracks folder-slot ownership as "<parentPageId>/<slot>" -> pack id.
    $slotOwner = @{}

    foreach ($entry in $ordered) {
        $spec = $entry.Spec
        $pack = $spec.pack

        if ($model.Packs.Contains($pack)) {
            throw "Pack id '$pack' is declared twice: '$($model.Packs[$pack].Path)' and '$($entry.Path)'."
        }
        $model.Packs[$pack] = $entry

        $profile = Get-SpecProperty $spec 'profile'
        if ($profile -and -not $model.ProfileName) { $model.ProfileName = $profile }

        # Palettes accumulate across packs, so a pack declares the accents its
        # own keys use. Keep client- and person-specific accent names in those
        # packs: ADR-0009 makes m-control the repo that stays free of client
        # material, and a palette key is still a client name. A pack that
        # forgets to declare one fails loudly in Resolve-DeckColor.
        foreach ($name in (ConvertTo-Hashtable (Get-SpecProperty $spec 'palette')).Keys) {
            $model.Palette[$name] = (Get-SpecProperty $spec 'palette').$name
        }
        foreach ($name in (ConvertTo-Hashtable (Get-SpecProperty $spec 'apps')).Keys) {
            $model.Apps[$name] = [pscustomobject]@{
                Pack = $pack; PackDir = $entry.PackDir
                Def  = (Get-SpecProperty $spec 'apps').$name
            }
        }
        foreach ($name in (ConvertTo-Hashtable (Get-SpecProperty $spec 'plugins')).Keys) {
            $model.Plugins[$name] = (Get-SpecProperty $spec 'plugins').$name
        }

        $req = Get-SpecProperty $spec 'requires'
        if ($req) {
            $model.Requires.bin     = @($model.Requires.bin)     + @(Get-SpecProperty $req 'bin'     @())
            $model.Requires.plugins = @($model.Requires.plugins) + @(Get-SpecProperty $req 'plugins' @())
        }

        $packAccent = Get-SpecProperty $spec 'accent'

        foreach ($pageId in (ConvertTo-Hashtable (Get-SpecProperty $spec 'pages')).Keys) {
            $pageSpec = (Get-SpecProperty $spec 'pages').$pageId

            # A pack may add keys to a page another pack owns (e.g. a personal
            # key on the shared Home page) by setting "extends": true. Without
            # it, a duplicate page id stays an error.
            if ($model.Pages.Contains($pageId)) {
                if (-not [bool](Get-SpecProperty $pageSpec 'extends' $false)) {
                    throw ("Page id '$pageId' is defined by both pack '$($model.Pages[$pageId].Pack)' " +
                           "and pack '$pack'. Page ids are global and must be unique; " +
                           'set "extends": true to add keys to an existing page instead.')
                }
                $target = $model.Pages[$pageId]
                foreach ($coord in (ConvertTo-Hashtable (Get-SpecProperty $pageSpec 'keys')).Keys) {
                    if ($target.Keys.Contains($coord)) {
                        $ownerPack = if ($target.KeyPacks.ContainsKey($coord)) { $target.KeyPacks[$coord].Pack } else { $target.Pack }
                        throw ("Key collision at [$coord] on page '$pageId': pack " +
                               "'$ownerPack' and pack '$pack' both define it.")
                    }
                    $def = (Get-SpecProperty $pageSpec 'keys').$coord
                    $target.Keys[$coord] = $def
                    $target.KeyPacks[$coord] = @{ Pack = $pack; PackDir = $entry.PackDir }
                }
                continue
            }

            $folder = Get-SpecProperty $pageSpec 'folder'
            if ($folder) {
                $parent = Get-SpecProperty $folder 'parent' $model.RootPageId
                $slot   = Get-SpecProperty $folder 'slot'
                if (-not $slot) {
                    throw "Page '$pageId' (pack '$pack') declares a folder without a 'slot'."
                }
                $key = "$parent/$slot"
                if ($slotOwner.ContainsKey($key)) {
                    throw ("Folder slot collision at [$slot] on page '$parent': pack " +
                           "'$($slotOwner[$key])' and pack '$pack' both claim it. " +
                           'Change one pack''s folder.slot.')
                }
                $slotOwner[$key] = $pack
            }

            $model.Pages[$pageId] = [pscustomobject]@{
                Id       = $pageId
                Pack     = $pack
                PackDir  = $entry.PackDir
                Label    = Get-SpecProperty $pageSpec 'label' $pageId
                Accent   = Get-SpecProperty $pageSpec 'accent' $packAccent
                Folder   = $folder
                BackSlot = Get-SpecProperty $pageSpec 'backSlot' '4,2'
                Keys     = ConvertTo-Hashtable (Get-SpecProperty $pageSpec 'keys')
                # Per-key pack attribution, so an extending pack's relative icon
                # and script paths resolve against ITS directory, not the owner's.
                KeyPacks = @{}
            }
        }
    }

    if (-not $model.ProfileName) {
        throw 'No pack declares a "profile" name and none was supplied via config.'
    }
    if (-not $model.Pages.Contains($model.RootPageId)) {
        throw "No pack defines the root page '$($model.RootPageId)'."
    }

    # Drop folder keys whose target page is absent - the "pack not installed"
    # case. Done after the merge so it covers cross-pack folder references too.
    foreach ($pageId in @($model.Pages.Keys)) {
        $page = $model.Pages[$pageId]
        if ($page.Folder) {
            $parent = Get-SpecProperty $page.Folder 'parent' $model.RootPageId
            if (-not $model.Pages.Contains($parent)) {
                $model.Pages.Remove($pageId)
            }
        }
    }

    $model.Requires.bin     = @($model.Requires.bin     | Where-Object { $_ } | Sort-Object -Unique)
    $model.Requires.plugins = @($model.Requires.plugins | Where-Object { $_ } | Sort-Object -Unique)

    return $model
}
