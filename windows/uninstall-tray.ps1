<#
    Remove the Tray from Windows. Run it from Windows:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\uninstall-tray.ps1

    It removes exactly what install-tray.ps1 wrote: the Tray Home, the Startup
    shortcut, and the Start Menu shortcut. It never reaches into the
    repository, the Registry, or a Plugin directory, and it leaves the Host
    running where it is - the Tray is a door, not the run.

    It names every path it removes, and every path it did not find.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$trayHome  = Join-Path $env:LOCALAPPDATA 'FirstMate\Tray'
$startup   = Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate Tray.lnk'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'FirstMate.lnk'

# The Tray is the program being removed, so it stops here. A running copy is
# found by the one file it runs, and by nothing else on the machine.
$trayScript = Join-Path $trayHome 'firstmate-tray.ps1'
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($trayScript) })
foreach ($process in $running) {
    try {
        Stop-Process -Id $process.ProcessId -Force
        Write-Output "stopped the running Tray (pid $($process.ProcessId))"
    } catch {
        Write-Output "could not stop the Tray (pid $($process.ProcessId)): $_"
    }
}
if ($running.Count -gt 0) {
    Write-Output "Its icon leaves the notification area when Windows next redraws it."
}

foreach ($path in $startup, $startMenu) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Output "removed $path"
    } else {
        Write-Output "not present: $path"
    }
}

if (Test-Path -LiteralPath $trayHome) {
    Remove-Item -LiteralPath $trayHome -Recurse -Force
    Write-Output "removed $trayHome"
} else {
    Write-Output "not present: $trayHome"
}

Write-Output ""
Write-Output "The Host itself is untouched. Stop it with: systemctl --user stop firstmate"
