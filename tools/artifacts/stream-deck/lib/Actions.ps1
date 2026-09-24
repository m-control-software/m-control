<#
    Verified Stream Deck action factories.

    Every shape here was harvested from a real profile created by the Stream
    Deck app - see SCHEMA.md. Nothing in this file may be invented: if a spec
    needs an action type that is not listed, add it in the app first, harvest
    the resulting JSON, then add a factory for it.

    Specs never carry Elgato UUIDs. A spec says {"type":"multimedia"} and this
    file owns the mapping, which keeps client packs free of vendor internals
    and makes "never invent schema" mechanical rather than a rule someone has
    to remember.
#>

Set-StrictMode -Version Latest

# Hotkey slots are a fixed-length array of four; unused slots carry this exact
# shape. NativeCode 146 / QTKeyCode 33554431 / VKeyCode -1 is what the app writes.
$script:EMPTY_HOTKEY_SLOT = [ordered]@{
    KeyCmd = $false; KeyCtrl = $false; KeyModifiers = 0; KeyOption = $false
    KeyShift = $false; NativeCode = 146; QTKeyCode = 33554431; VKeyCode = -1
}

function Merge-Settings {
    <# Deep-merges an override object into a base dictionary. #>
    [CmdletBinding()] param([System.Collections.IDictionary]$Base, $Override)
    if ($null -eq $Override) { return $Base }
    foreach ($p in $Override.PSObject.Properties) {
        # IDictionary, not [hashtable]: ConvertTo-OrderedDeep produces
        # OrderedDictionary, which is not a Hashtable and would otherwise fall
        # through to wholesale replacement instead of merging.
        if ($Base.Contains($p.Name) -and $Base[$p.Name] -is [System.Collections.IDictionary] -and
            $p.Value -is [psobject] -and $p.Value -isnot [string] -and $p.Value -isnot [array]) {
            $Base[$p.Name] = Merge-Settings -Base $Base[$p.Name] -Override $p.Value
        } else {
            $Base[$p.Name] = $p.Value
        }
    }
    return $Base
}

function New-ActionEnvelope {
    <# Fields every action carries, regardless of type. #>
    [CmdletBinding()] param(
        [string]$ActionId, [string]$Name, [string]$Uuid,
        $Settings, [hashtable]$Plugin, [bool]$LinkedTitle = $true, [int]$StateCount = 1
    )
    $a = [ordered]@{
        ActionID    = $ActionId
        LinkedTitle = $LinkedTitle
        Name        = $Name
    }
    if ($Plugin) { $a['Plugin'] = $Plugin }
    $a['Resources'] = $null
    $a['Settings']  = if ($null -eq $Settings) { [ordered]@{} } else { $Settings }
    $a['State']     = 0
    $a['States']    = @(1..$StateCount | ForEach-Object { @{} })
    $a['UUID']      = $Uuid
    return $a
}

function New-DeckAction {
    <#
        Builds one action from a spec key definition.

        $Context supplies everything the factories need that the spec does not
        carry directly: resolved app paths, the pack directory for relative
        script references, page-id -> GUID mapping, and pack-declared plugins.
    #>
    [CmdletBinding()] param(
        [Parameter(Mandatory)]$Action,
        [Parameter(Mandatory)][string]$ActionId,
        [Parameter(Mandatory)][hashtable]$Context
    )

    $type = Get-SpecProperty $Action 'type'
    if (-not $type) { throw "Key action is missing 'type'." }

    switch ($type) {

        'multimedia' {
            # Verified actionIdx: 0=Play/Pause 1=Next 2=Previous 3=Stop 4=Mute
            # 5=Volume Up 6=Volume Down (harvested from the stock Default Profile).
            $idx = Get-SpecProperty $Action 'index'
            if ($null -eq $idx) { throw "multimedia action requires 'index'." }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Multimedia' `
                -Uuid 'com.elgato.streamdeck.system.multimedia' `
                -Plugin ([ordered]@{ Name = 'Multimedia'; UUID = 'com.elgato.streamdeck.system.multimedia'; Version = '1.0' }) `
                -Settings ([ordered]@{ actionIdx = [int]$idx })
        }

        'open' {
            # No Plugin block. Settings.path takes a bare command, a file path
            # or a URI scheme.
            #
            # 'file' is the pack-relative form, resolved here so no spec ever
            # stores a machine-specific path. It exists alongside 'script'
            # because some targets must launch through their own wrapper - a
            # .vbs that starts pwsh hidden, say - which 'script' would replace
            # with a visible console window.
            $file = Get-SpecProperty $Action 'file'
            if ($file) {
                $full = Join-Path $Context.PackDir $file
                if (-not (Test-Path -LiteralPath $full)) {
                    throw "open action points at '$file', which does not exist in pack dir '$($Context.PackDir)'."
                }
                $target = (Resolve-Path -LiteralPath $full).Path
            } else {
                $target = Get-SpecProperty $Action 'target'
            }
            if (-not $target) { throw "open action requires 'target' or 'file'." }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Open' `
                -Uuid 'com.elgato.streamdeck.system.open' `
                -Settings ([ordered]@{ path = $target })
        }

        'website' {
            $url = Get-SpecProperty $Action 'url'
            if (-not $url) { throw "website action requires 'url'." }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Website' `
                -Uuid 'com.elgato.streamdeck.system.website' `
                -Plugin ([ordered]@{ Name = 'Website'; UUID = 'com.elgato.streamdeck.system.website'; Version = '1.0' }) `
                -Settings ([ordered]@{ openInBrowser = $true; path = $url })
        }

        'app' {
            $appId = Get-SpecProperty $Action 'app'
            if (-not $appId) { throw "app action requires 'app'." }
            $exe = $Context.ResolvedApps[$appId]
            if (-not $exe) { throw "app action references unresolved app '$appId'." }
            $bundleId = $null
            $bundleMap = Get-SpecProperty $Context 'AppBundleIds'
            if ($bundleMap -and $bundleMap.Contains($appId)) { $bundleId = $bundleMap[$appId] }
            return New-OpenAppAction -ActionId $ActionId -Title (Get-SpecProperty $Action 'title' $appId) `
                -Exe $exe -AppArgs @(Get-SpecProperty $Action 'args' @()) -BundleId $bundleId
        }

        'script' {
            # Script paths are stored relative to the pack directory and made
            # absolute here, so no machine-specific path ever enters a spec.
            $rel = Get-SpecProperty $Action 'script'
            if (-not $rel) { throw "script action requires 'script'." }
            $full = Join-Path $Context.PackDir $rel
            if (-not (Test-Path -LiteralPath $full)) {
                throw "script action points at '$rel', which does not exist in pack dir '$($Context.PackDir)'."
            }
            $full = (Resolve-Path -LiteralPath $full).Path
            $pwshExe = $Context.ResolvedApps['pwsh']
            if (-not $pwshExe) { throw "script action needs the 'pwsh' app to be resolvable." }
            return New-OpenAppAction -ActionId $ActionId -Title (Get-SpecProperty $Action 'title' 'Script') `
                -Exe $pwshExe -AppArgs @('-NoLogo', '-NoProfile', '-File', $full)
        }

        'hotkey' {
            $slots = @(Get-SpecProperty $Action 'hotkeys' @())
            if ($slots.Count -eq 0) { throw "hotkey action requires a non-empty 'hotkeys' array." }
            $built = @()
            foreach ($s in $slots) {
                $built += [ordered]@{
                    KeyCmd       = [bool](Get-SpecProperty $s 'cmd'    $false)
                    KeyCtrl      = [bool](Get-SpecProperty $s 'ctrl'   $false)
                    KeyModifiers = [int] (Get-SpecProperty $s 'modifiers' 0)
                    KeyOption    = [bool](Get-SpecProperty $s 'option' $false)
                    KeyShift     = [bool](Get-SpecProperty $s 'shift'  $false)
                    NativeCode   = [int] (Get-SpecProperty $s 'native' 0)
                    QTKeyCode    = [int] (Get-SpecProperty $s 'qt'     0)
                    VKeyCode     = [int] (Get-SpecProperty $s 'vkey'   0)
                }
            }
            while ($built.Count -lt 4) { $built += $script:EMPTY_HOTKEY_SLOT }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Hotkey' `
                -Uuid 'com.elgato.streamdeck.system.hotkey' `
                -Plugin ([ordered]@{ Name = 'Activate a Key Command'; UUID = 'com.elgato.streamdeck.system.hotkey'; Version = '1.0' }) `
                -Settings ([ordered]@{ Coalesce = $true; Hotkeys = @($built | Select-Object -First 4) })
        }

        'folder' {
            # ProfileUUID is the CHILD page GUID, lower-case.
            $target = Get-SpecProperty $Action 'page'
            $guid = $Context.PageGuids[$target]
            if (-not $guid) { throw "folder action targets unknown page '$target'." }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Create Folder' `
                -Uuid 'com.elgato.streamdeck.profile.openchild' `
                -Plugin ([ordered]@{ Name = 'Create Folder'; UUID = 'com.elgato.streamdeck.profile.openchild'; Version = '1.0' }) `
                -Settings ([ordered]@{ ProfileUUID = $guid })
        }

        'back' {
            return New-ActionEnvelope -ActionId $ActionId -Name 'Parent Folder' `
                -Uuid 'com.elgato.streamdeck.profile.backtoparent' `
                -Plugin ([ordered]@{ Name = 'Open Parent Folder'; UUID = 'com.elgato.streamdeck.profile.backtoparent'; Version = '1.0' }) `
                -Settings ([ordered]@{})
        }

        'profile' {
            # ProfileUUID here is a sibling BUNDLE's folder GUID, lower-case -
            # resolved by profile name so hand-maintained profiles are never
            # touched, only referenced. PageIndex=1 is the only observed value.
            $target = Get-SpecProperty $Action 'profile'
            if (-not $target) { throw "profile action requires 'profile'." }
            $guid = $Context.SiblingProfiles[$target]
            if (-not $guid) {
                # Sibling profiles are hand-maintained and may simply not exist
                # yet on this machine. Aborting the whole generate would make
                # the tool unusable on a fresh install, so emit an inert key -
                # which is what the app itself shows for a deleted target - and
                # let the caller report it alongside unresolved apps.
                $missing = Get-SpecProperty $Context 'MissingProfiles'
                if ($null -ne $missing -and -not $missing.Contains($target)) { $missing.Add($target) }
                $guid = ''
            }
            return New-ActionEnvelope -ActionId $ActionId -Name 'Switch Profile' `
                -Uuid 'com.elgato.streamdeck.profile.rotate' `
                -Plugin ([ordered]@{ Name = 'Switch Profile'; UUID = 'com.elgato.streamdeck.profile.rotate'; Version = '1.0' }) `
                -Settings ([ordered]@{ DeviceUUID = ''; PageIndex = 1; ProfileUUID = $guid })
        }

        'plugin' {
            # Third-party plugin actions. The template is declared by whichever
            # pack owns the plugin, so client-specific plugins never need an
            # entry in the shared repo.
            $id = Get-SpecProperty $Action 'plugin'
            if (-not $id) { throw "plugin action requires 'plugin'." }
            $tpl = $Context.Plugins[$id]
            if (-not $tpl) { throw "plugin action references undeclared plugin '$id'." }

            $settings = ConvertTo-OrderedDeep (Get-SpecProperty $tpl 'settings')
            $settings = Merge-Settings -Base $settings -Override (Get-SpecProperty $Action 'settings')

            $pluginBlock = $null
            $pm = Get-SpecProperty $tpl 'manifest'
            if ($pm) {
                $pluginBlock = [ordered]@{
                    Name    = Get-SpecProperty $pm 'Name'
                    UUID    = Get-SpecProperty $pm 'UUID'
                    Version = Get-SpecProperty $pm 'Version'
                }
            }
            return New-ActionEnvelope -ActionId $ActionId `
                -Name (Get-SpecProperty $tpl 'name' $id) `
                -Uuid (Get-SpecProperty $tpl 'uuid') `
                -Plugin $pluginBlock `
                -LinkedTitle ([bool](Get-SpecProperty $tpl 'linkedTitle' $false)) `
                -StateCount ([int](Get-SpecProperty $tpl 'stateCount' 1)) `
                -Settings $settings
        }

        default { throw "Unknown action type '$type'. Add a verified factory for it first." }
    }
}

function New-OpenAppAction {
    [CmdletBinding()] param(
        [string]$ActionId, [string]$Title, [string]$Exe, [string[]]$AppArgs = @(),
        [string]$BundleId
    )
    # Do not rename $AppArgs to $args: that collides with PowerShell's automatic
    # per-function $args and silently binds an empty array instead.
    # Store apps identify themselves by AppUserModelId rather than by path, and
    # the app refuses to launch them unless is_bundle is set alongside it.
    $isBundle = [bool]$BundleId
    $id = if ($isBundle) { $BundleId } else { $Exe }
    return New-ActionEnvelope -ActionId $ActionId -Name 'Open Application' `
        -Uuid 'com.elgato.streamdeck.system.openapp' `
        -Plugin ([ordered]@{ Name = 'Open Application'; UUID = 'com.elgato.streamdeck.system.openapp'; Version = '1.0' }) `
        -Settings ([ordered]@{
            app_name = $Title; args = $AppArgs; bring_to_front = $true
            bundle_id = $id; bundle_path = $Exe; exec = $Exe
            is_bundle = $isBundle; long_press = 'quit'; source = $Exe
        })
}

function ConvertTo-OrderedDeep {
    <# PSCustomObject tree -> nested ordered hashtables, so Merge-Settings can recurse. #>
    [CmdletBinding()] param($Object)
    if ($null -eq $Object) { return [ordered]@{} }
    if ($Object -is [string] -or $Object -is [int] -or $Object -is [bool] -or $Object -is [array]) {
        return $Object
    }
    $h = [ordered]@{}
    foreach ($p in $Object.PSObject.Properties) {
        $v = $p.Value
        if ($null -ne $v -and $v -is [psobject] -and $v -isnot [string] -and
            $v -isnot [array] -and $v -isnot [int] -and $v -isnot [bool]) {
            $h[$p.Name] = ConvertTo-OrderedDeep $v
        } else {
            $h[$p.Name] = $v
        }
    }
    return $h
}
