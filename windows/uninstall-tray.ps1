<#
    Remove the Tray from Windows. Run it from Windows:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\uninstall-tray.ps1

    It removes exactly what install-tray.ps1 wrote: the launcher, the Start
    Menu shortcut, and the package. It also removes the Startup entry the
    program writes for itself, because leaving that behind would start a
    program that is no longer installed, and the key that names FirstMate's
    Notices to Windows, which the program writes every time it starts.

    It never reaches into the repository, the Registry, or a Plugin directory,
    and it leaves the Host running where it is - the Tray is a door, not the
    run.

    It names every path it removes, and every path it did not find.
#>
[CmdletBinding()]
param(
    # Leave the package installed. Useful when only the Windows side is being
    # put back together.
    [switch] $KeepPackage
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Package = '@luan-afonso/firstmate'

function Remove-OldTray {
    <#
        Take the PowerShell Tray away.

        It was a copy of four scripts in a Tray Home of its own, started from a
        Startup shortcut. The program replaces all of it, and leaving it behind
        would mean two Trays, two icons, and two things called FirstMate at
        logon. This runs whether or not the old Tray was ever installed.
    #>
    $oldHome    = Join-Path $env:LOCALAPPDATA 'FirstMate\Tray'
    $oldStartup = Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate Tray.lnk'
    $oldScript  = Join-Path $oldHome 'firstmate-tray.ps1'

    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($oldScript) })) {
        try {
            Stop-Process -Id $process.ProcessId -Force
            Write-Output "stopped the PowerShell Tray (pid $($process.ProcessId))"
        } catch {
            Write-Output "could not stop the PowerShell Tray (pid $($process.ProcessId)): $_"
        }
    }
    foreach ($path in $oldStartup, $oldHome) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force
            Write-Output "retired $path"
        }
    }
}

$home_     = Join-Path $env:LOCALAPPDATA 'FirstMate'
$launcher  = Join-Path $home_ 'firstmate-window.vbs'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'FirstMate.lnk'
$startup   = Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate.vbs'

# The Tray is the program being removed, so it stops here. A running copy is
# found by the command line it was started with, and by nothing else.
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '\bdesktop\b' -and
                   $_.CommandLine -match 'firstmate' })
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

# Anything the PowerShell Tray left behind goes too, so that removing FirstMate
# from Windows removes every version of it.
Remove-OldTray

foreach ($path in $startup, $startMenu, $launcher) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Output "removed $path"
    } else {
        Write-Output "not present: $path"
    }
}

# The browser data the window kept is the window's, not FirstMate's, and it
# goes with the window. Nothing of a Plugin's is in it.
$data = Join-Path $home_ 'Window'
if (Test-Path -LiteralPath $data) {
    Remove-Item -LiteralPath $data -Recurse -Force
    Write-Output "removed $data"
} else {
    Write-Output "not present: $data"
}

# The key that tells Windows a Notice from FirstMate is called FirstMate and
# wears its mark. The program writes it at every start (src/notice-helper.ts).
$noticeKey = 'HKCU:\Software\Classes\AppUserModelId\LuanAfonso.FirstMate'
if (Test-Path -LiteralPath $noticeKey) {
    Remove-Item -LiteralPath $noticeKey -Recurse -Force
    Write-Output "removed $noticeKey"
} else {
    Write-Output "not present: $noticeKey"
}

if ($KeepPackage) {
    Write-Output "kept the package, as asked."
} else {
    & npm.cmd uninstall --global --no-fund --no-audit $Package
    if ($LASTEXITCODE -eq 0) {
        Write-Output "removed the $Package package."
    } else {
        Write-Output "npm would not remove $Package. Remove it with: npm uninstall -g $Package"
    }
}

Write-Output ""
Write-Output "The Host itself is untouched. Stop it with: systemctl --user stop firstmate"
Write-Output "The logon task that holds the distribution up is untouched as well."
Write-Output "Remove that with uninstall-logon-task.ps1."
