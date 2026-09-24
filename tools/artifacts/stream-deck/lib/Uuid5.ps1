<#
    Deterministic GUID derivation (RFC 4122 section 4.3, SHA-1 / version 5).

    Every GUID the generator writes descends from MCTL_SD_NAMESPACE, so running
    the generator twice on the same spec produces byte-identical output and the
    Stream Deck app keeps its per-application profile bindings instead of
    treating each run as a brand-new profile.

    Verified against the live app 2026-09-24: a bundle whose GUID and all 11
    page GUIDs were produced this way loaded correctly, and the app rewrote the
    bundle manifest byte-identically.
#>

Set-StrictMode -Version Latest

# Fixed namespace for m-control Stream Deck generation. Changing this value
# re-derives every GUID, which orphans the existing profile in the app.
$script:MCTL_SD_NAMESPACE = 'b7c1f0e2-3a5d-4c8b-9e6f-1d2a3b4c5d6e'

function New-UuidV5 {
    [CmdletBinding()] param(
        [Parameter(Mandatory)][string]$Name,
        [string]$Namespace = $script:MCTL_SD_NAMESPACE
    )

    $ns = ([guid]$Namespace).ToByteArray()
    # .NET stores the first three fields little-endian; RFC 4122 hashes big-endian.
    [array]::Reverse($ns, 0, 4); [array]::Reverse($ns, 4, 2); [array]::Reverse($ns, 6, 2)

    $sha = [System.Security.Cryptography.SHA1]::Create()
    try { $hash = $sha.ComputeHash($ns + [System.Text.Encoding]::UTF8.GetBytes($Name)) }
    finally { $sha.Dispose() }

    $b = [byte[]]$hash[0..15]
    $b[6] = ($b[6] -band 0x0F) -bor 0x50   # version 5
    $b[8] = ($b[8] -band 0x3F) -bor 0x80   # RFC 4122 variant

    [array]::Reverse($b, 0, 4); [array]::Reverse($b, 4, 2); [array]::Reverse($b, 6, 2)
    return [guid][byte[]]$b
}

function Get-ProfileGuid {
    <# Bundle GUID for a profile name. Upper-case: bundle directory convention. #>
    [CmdletBinding()] param([Parameter(Mandatory)][string]$ProfileName)
    (New-UuidV5 -Name "profile:$ProfileName").ToString().ToUpperInvariant()
}

function Get-PageGuid {
    <#
        Page GUID for a logical page id within a profile. Lower-case: this is the
        form the app stores in Settings.ProfileUUID for folder navigation, and
        mixing case there breaks the reference.
    #>
    [CmdletBinding()] param(
        [Parameter(Mandatory)][string]$ProfileName,
        [Parameter(Mandatory)][string]$PageId
    )
    (New-UuidV5 -Name "page:$ProfileName/$PageId").ToString().ToLowerInvariant()
}
