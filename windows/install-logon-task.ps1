<#
    Install the logon task on Windows. Run it once, from Windows, from where
    FirstMate is inside WSL, over \\wsl.localhost\. `firstmate service on`
    prints the exact command, which is of this form:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<path to FirstMate>\windows\install-logon-task.ps1

    <path to FirstMate> is a clone, or the directory npm installed the package in.

    It writes exactly two places outside the repository:

      1. the FirstMate Home on Windows, %LOCALAPPDATA%\FirstMate, which holds a
         copy of the holder and the launch shim, so that a stopped
         distribution can still be started;
      2. one Task Scheduler entry, "FirstMate Host", which runs the holder at
         logon.

    It works out the distribution from the path it is running from, so nothing
    here is hardcoded and no configuration file is written.

    uninstall-logon-task.ps1 removes exactly what this wrote.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TaskName = 'FirstMate Host'

function Get-Distribution {
    <#
        The WSL distribution, read out of the path this script is running from.
        `\\wsl.localhost\Debian\home\<user>\...\windows\...` names it; a
        copy on the Windows filesystem does not.
    #>
    param([string] $Path)
    if ([string]::IsNullOrEmpty($Path)) { return $null }
    if ($Path -notmatch '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\') { return $null }
    return $Matches[1]
}

$distro = Get-Distribution -Path $PSCommandPath
if ($null -eq $distro) {
    Write-Error ("Run this from inside WSL over \\wsl.localhost\, so that it can tell " +
        "which distribution holds the Host. Inside WSL, firstmate service on prints " +
        "the exact command.")
    exit 1
}

$here = Split-Path -Path $PSCommandPath -Parent
$home_ = Join-Path $env:LOCALAPPDATA 'FirstMate'
New-Item -ItemType Directory -Path $home_ -Force | Out-Null
# uninstall-logon-task.ps1 removes these two files by name. Keep the lists the same.
foreach ($file in 'hold-distribution.ps1', 'firstmate-hidden.vbs') {
    Copy-Item -Path (Join-Path $here $file) -Destination $home_ -Force
}
$shim = Join-Path $home_ 'firstmate-hidden.vbs'

# wscript.exe runs the shim, the shim runs the holder with no window, and the
# holder keeps one process alive inside the distribution.
$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
    -Argument ('"{0}" hold-distribution.ps1 -Distro "{1}"' -f $shim, $distro) `
    -WorkingDirectory $home_
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force `
    -Description 'Start WSL at logon and hold it up, so that the FirstMate Host is running.' |
    Out-Null

Write-Output "FirstMate logon task installed."
Write-Output "  distribution:  $distro"
Write-Output "  FirstMate Home: $home_"
Write-Output "  task:          $TaskName"
Write-Output ""
Write-Output "Start it now without logging out:"
Write-Output "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Remove all of it with uninstall-logon-task.ps1."
