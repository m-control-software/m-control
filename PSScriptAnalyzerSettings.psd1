# PSScriptAnalyzer settings for every *.ps1 in the repo (scripts/lint-powershell.ps1).
#
# AGENTS.md: PowerShell must parse and run under Windows PowerShell 5.1, which
# is what the `powershell` runtime spawns on Windows. These rules make that a
# check instead of a convention: syntax (no ternaries, no ??, no &&), commands
# and parameters, and .NET types are all checked against the 5.1 profile, so
# the check also runs on Linux CI under pwsh 7.
@{
    Severity     = @('Error', 'Warning')
    IncludeRules = @(
        'PSUseCompatibleSyntax',
        'PSUseCompatibleCommands',
        'PSUseCompatibleTypes',
        # stdout is reserved for NDJSON ToolEvents.
        'PSAvoidUsingWriteHost',
        'PSAvoidUsingCmdletAliases',
        'PSAvoidUsingEmptyCatchBlock',
        'PSUseDeclaredVarsMoreThanAssignments'
    )
    Rules        = @{
        PSUseCompatibleSyntax   = @{
            Enable         = $true
            TargetVersions = @('5.1')
        }
        PSUseCompatibleCommands = @{
            Enable         = $true
            # Windows PowerShell 5.1 on Windows 10 / Server 2019, .NET Framework.
            TargetProfiles = @('win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework')
            # External executables, not PowerShell commands.
            IgnoreCommands = @('node', 'yarn', 'npm', 'git', 'python', 'python3', 'py', 'dotnet', 'pwsh', 'powershell')
        }
        PSUseCompatibleTypes    = @{
            Enable         = $true
            TargetProfiles = @('win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework')
        }
    }
}
