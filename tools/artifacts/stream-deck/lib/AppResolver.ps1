<#
    App resolution.

    Specs name an application ("vscode"); this file turns that into an absolute
    path on the current machine. That indirection is the whole portability fix:
    no spec ever stores C:\Users\<name>\... , and a versioned path like the
    Snipping Tool's WindowsApps directory is matched by glob so it survives the
    updates that have broken it twice already.

    Generalised from the original Repair-StreamDeckPaths.ps1.
#>

Set-StrictMode -Version Latest

function Expand-AppPath {
    <# Expands %VAR% style environment references. #>
    [CmdletBinding()] param([string]$Path)
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Resolve-DeckApp {
    <#
        Resolves one app definition to an absolute executable path.

        Definition fields:
          candidates : ordered list of absolute paths; may contain wildcards
          command    : bare command name to look up on PATH as a last resort

        Wildcard candidates resolve to the highest-sorting match, which picks
        the newest version for paths like Microsoft.ScreenSketch_11.2607.23.0_x64.
        Returns $null when nothing matches - callers decide whether that is fatal.
    #>
    [CmdletBinding()] param([Parameter(Mandatory)]$Definition)

    foreach ($candidate in @(Get-SpecProperty $Definition 'candidates' @())) {
        $expanded = Expand-AppPath $candidate

        if ($expanded -match '[*?]') {
            # Not $matches: the -match above populates that automatic variable.
            $hits = @(Resolve-Path -Path $expanded -ErrorAction SilentlyContinue |
                      Sort-Object -Property Path -Descending)
            if ($hits.Count -gt 0) { return $hits[0].Path }
            continue
        }

        if (Test-Path -LiteralPath $expanded -PathType Leaf) { return $expanded }
    }

    $command = Get-SpecProperty $Definition 'command'
    if ($command) {
        $cmd = Get-Command $command -CommandType Application -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }

    return $null
}

function Resolve-DeckApps {
    <#
        Resolves every app declared across all packs.
        Returns @{ Resolved = @{id->path}; Missing = @(id) }.
    #>
    [CmdletBinding()] param([Parameter(Mandatory)]$Model)

    $resolved = @{}
    $missing  = [System.Collections.Generic.List[string]]::new()

    foreach ($id in $Model.Apps.Keys) {
        $path = Resolve-DeckApp -Definition $Model.Apps[$id].Def
        if ($path) { $resolved[$id] = $path } else { $missing.Add($id) }
    }

    return @{ Resolved = $resolved; Missing = @($missing) }
}
