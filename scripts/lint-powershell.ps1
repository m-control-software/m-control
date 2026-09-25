<#
    Lints every *.ps1 under tools/, templates/ and scripts/ with
    PSScriptAnalyzer, using PSScriptAnalyzerSettings.psd1 at the repo root.
    Exits 1 on any finding, so `yarn verify` fails.

    Needs PSScriptAnalyzer at the version pinned in linters.json;
    `node scripts/setup-linters.mjs` installs it.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$settings = Join-Path $repoRoot 'PSScriptAnalyzerSettings.psd1'

$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'linters.json') -Raw | ConvertFrom-Json).PSScriptAnalyzer
$available = Get-Module -ListAvailable -Name PSScriptAnalyzer | Where-Object { $_.Version -eq [version]$version }
if (-not $available) {
    [Console]::Error.WriteLine("PSScriptAnalyzer $version is not installed. Run: node scripts/setup-linters.mjs")
    exit 1
}
Import-Module PSScriptAnalyzer -RequiredVersion $version

$findings = @()
foreach ($dir in 'tools', 'templates', 'scripts') {
    $path = Join-Path $repoRoot $dir
    if (Test-Path -LiteralPath $path) {
        $findings += @(Invoke-ScriptAnalyzer -Path $path -Recurse -Settings $settings)
    }
}

foreach ($f in $findings) {
    $rel = $f.ScriptPath.Substring($repoRoot.Length + 1)
    [Console]::Out.WriteLine(('{0}:{1}:{2} {3} {4}' -f $rel, $f.Line, $f.Column, $f.RuleName, $f.Message))
}

if ($findings.Count -gt 0) {
    [Console]::Out.WriteLine("$($findings.Count) PowerShell finding(s).")
    exit 1
}
[Console]::Out.WriteLine('PowerShell: no findings.')
