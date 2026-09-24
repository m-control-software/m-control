<#
    Tool Protocol v1 emission helpers.

    stdout carries NDJSON ToolEvent lines and nothing else. Every human-readable
    message must go through Write-ToolLog; a stray Write-Host would corrupt the
    stream, so nothing in this tool may call it.

    [Console]::Out is used rather than Write-Output because PowerShell's normal
    output pipeline applies formatting and line-width wrapping to strings, which
    would break long JSON lines.
#>

Set-StrictMode -Version Latest

$script:ToolId = 'stream-deck'

function Write-ToolEvent {
    [CmdletBinding()] param(
        [Parameter(Mandatory)][ValidateSet('started', 'log', 'result', 'error')][string]$Type,
        [Parameter(Mandatory)]$Payload
    )
    $evt = [ordered]@{
        type    = $Type
        ts      = (Get-Date).ToUniversalTime().ToString('o')
        toolId  = $script:ToolId
        payload = $Payload
    }
    [Console]::Out.WriteLine(($evt | ConvertTo-Json -Depth 20 -Compress))
}

function Write-ToolStarted {
    [CmdletBinding()] param([hashtable]$Meta = @{})
    Write-ToolEvent -Type 'started' -Payload ([ordered]@{ meta = $Meta })
}

function Write-ToolLog {
    [CmdletBinding()] param(
        [Parameter(Mandatory)][ValidateSet('debug', 'info', 'warn', 'error')][string]$Level,
        [Parameter(Mandatory)][string]$Message,
        $Data
    )
    $p = [ordered]@{ level = $Level; message = $Message }
    if ($PSBoundParameters.ContainsKey('Data')) { $p['data'] = $Data }
    Write-ToolEvent -Type 'log' -Payload $p
}

function Write-ToolResult {
    [CmdletBinding()] param([Parameter(Mandatory)]$Payload)
    Write-ToolEvent -Type 'result' -Payload $Payload
}

function Write-ToolError {
    [CmdletBinding()] param(
        [Parameter(Mandatory)][string]$Message,
        [Parameter(Mandatory)][string]$Code,
        [bool]$Recoverable = $true
    )
    Write-ToolEvent -Type 'error' -Payload ([ordered]@{
        message = $Message; code = $Code; recoverable = $Recoverable
    })
}

function Read-ToolRequest {
    <#
        Reads the single JSON ToolRequest from stdin to EOF before any work
        begins, per Tool Protocol v1.
    #>
    [CmdletBinding()] param()
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw 'Empty stdin - expected a JSON ToolRequest.'
    }
    try { return $raw | ConvertFrom-Json }
    catch { throw "Failed to parse ToolRequest from stdin: $($_.Exception.Message)" }
}
