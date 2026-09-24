<#
    Icon composition.

    Turns a spec icon object into a finished 288x288 PNG by driving the
    primitives in IconEngine.ps1. Keeping this separate means the drawing code
    stays a verbatim port while the spec-facing shape can evolve.

    Icon forms:
      { "glyph": "folder" }                              vector glyph
      { "badge": "AB" }                                  letter/emoji badge
      { "image": "icons/acme-logo.png", "scale": 0.56 }    real logo
      { "image": "icons/acme-mark.png", "mono": true }     mono mark recoloured white

    'image' is always relative to the pack that declared the key. That is the
    portability rule: no spec ever contains a machine-specific absolute path.
#>

Set-StrictMode -Version Latest

function Resolve-DeckColor {
    <#
        Accepts a palette name ("teal") or a literal "#RRGGBB" and returns a
        System.Drawing.Color. Unknown names are an error rather than a silent
        fallback - a wrong-coloured key is hard to spot across 90 of them.
    #>
    [CmdletBinding()] param([string]$Value, [System.Collections.IDictionary]$Palette)

    if ([string]::IsNullOrWhiteSpace($Value)) { $Value = 'utility' }

    if ($Value.StartsWith('#')) {
        $hex = $Value.TrimStart('#')
        if ($hex.Length -ne 6) { throw "Invalid colour '$Value' - expected #RRGGBB." }
        return [System.Drawing.Color]::FromArgb(255,
            [Convert]::ToInt32($hex.Substring(0, 2), 16),
            [Convert]::ToInt32($hex.Substring(2, 2), 16),
            [Convert]::ToInt32($hex.Substring(4, 2), 16))
    }

    # .Contains, not .ContainsKey: OrderedDictionary has no ContainsKey.
    if (-not $Palette.Contains($Value)) {
        throw "Unknown accent '$Value'. Known accents: $(($Palette.Keys | Sort-Object) -join ', ')."
    }
    $hexValue = $Palette[$Value]
    if ($hexValue -notmatch '^#[0-9a-fA-F]{6}$') {
        throw "Palette entry '$Value' is '$hexValue'; palette values must be literal #RRGGBB."
    }
    return Resolve-DeckColor -Value $hexValue -Palette @{}
}

function Resolve-IconImagePath {
    <# Pack-relative image path -> absolute, with a clear error if absent. #>
    [CmdletBinding()] param([string]$Relative, [string]$PackDir)

    if ([System.IO.Path]::IsPathRooted($Relative)) {
        throw ("Icon image '$Relative' is an absolute path. Spec images must be " +
               'relative to the pack directory so the spec stays portable.')
    }
    $full = Join-Path $PackDir $Relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw "Icon image not found: $full"
    }
    return $full
}

function Render-DeckIcon {
    [CmdletBinding()] param(
        $Icon,
        [string]$Accent,
        [bool]$Muted,
        [string]$PackDir,
        [hashtable]$Context,
        [Parameter(Mandatory)][string]$OutPath
    )

    $color = Resolve-DeckColor -Value $Accent -Palette $Context.Palette

    $canvas = New-Canvas
    Fill-Card  $canvas.G $color $Muted
    Add-TopBar $canvas.G $color $Muted
    if ($Muted) { Add-UnconfiguredDot $canvas.G }

    if ($null -ne $Icon) {
        $glyph = Get-SpecProperty $Icon 'glyph'
        $badge = Get-SpecProperty $Icon 'badge'
        $image = Get-SpecProperty $Icon 'image'
        $scale = [double](Get-SpecProperty $Icon 'scale' 0.54)

        if     ($glyph) { Draw-Glyph $canvas.G $glyph $false }
        elseif ($badge) { Draw-LetterBadge $canvas.G $badge $false }
        elseif ($image) {
            $path = Resolve-IconImagePath -Relative $image -PackDir $PackDir
            if ([bool](Get-SpecProperty $Icon 'mono' $false)) {
                Composite-ImageWhite $canvas.G $path $scale
            } else {
                Composite-Image $canvas.G $path $scale
            }
        }
        else { throw "Icon object has none of 'glyph', 'badge' or 'image'." }
    }

    Save-Icon $canvas $OutPath
}
