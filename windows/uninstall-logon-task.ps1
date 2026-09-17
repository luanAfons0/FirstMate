<#
    Remove the logon task from Windows. Run it from Windows:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\uninstall-logon-task.ps1

    It removes exactly what install-logon-task.ps1 wrote: the Task Scheduler
    entry and the FirstMate Home on Windows. It never reaches into the
    repository, the Registry, or a Plugin directory, and it leaves the Host
    running where it is: stop that with `systemctl --user stop firstmate`.

    It names every path it removes, and every path it did not find.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TaskName = 'FirstMate Host'
$home_ = Join-Path $env:LOCALAPPDATA 'FirstMate'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "removed the task: $TaskName"
} else {
    Write-Output "not present: the task $TaskName"
}

if (Test-Path -LiteralPath $home_) {
    Remove-Item -LiteralPath $home_ -Recurse -Force
    Write-Output "removed $home_"
} else {
    Write-Output "not present: $home_"
}

Write-Output ""
Write-Output "The Host itself is untouched. Stop it with: systemctl --user stop firstmate"
