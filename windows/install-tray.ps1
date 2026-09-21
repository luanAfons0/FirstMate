<#
    Install the Tray on Windows. Run it once, from Windows, from this
    repository over \\wsl.localhost\:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\install-tray.ps1

    It writes exactly two places outside the repository:

      1. the Tray Home, %LOCALAPPDATA%\FirstMate\Tray, which holds a copy of
         the Tray, the opener, the shared reader and the launch shim;
      2. the user's own shortcut folders, which get a Startup shortcut that
         starts the Tray at logon and a Start Menu shortcut that opens the
         Index Page without the Tray.

    It works out the distribution from the path it is running from, and asks
    the distribution once where the Host's home directory is. That is the only
    wsl.exe call anywhere in the Tray, and it happens here, at install time,
    never when the Index Page is opened.

    uninstall-tray.ps1 removes exactly what this wrote.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-Distribution {
    param([string] $Path)
    if ([string]::IsNullOrEmpty($Path)) { return $null }
    if ($Path -notmatch '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\') { return $null }
    return $Matches[1]
}

function New-Shortcut {
    param([string] $Path, [string] $Target, [string] $Arguments, [string] $Description)
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath       = $Target
    $link.Arguments        = $Arguments
    $link.WorkingDirectory = Split-Path -Path $Target -Parent
    $link.Description      = $Description
    $link.Save()
}

$distro = Get-Distribution -Path $PSCommandPath
if ($null -eq $distro) {
    Write-Error ("Run this from the repository over \\wsl.localhost\, so that it can tell " +
        "which distribution holds the Host. It is at " +
        "\\wsl.localhost\<Distro>\<home>\.first-mate\windows\install-tray.ps1.")
    exit 1
}

# The Host's home directory, from the Host's own rule: FIRSTMATE_HOME, or
# ~/.firstmate. Asked once, here, so that the Tray never has to ask.
$firstMateHome = (& wsl.exe -d $distro --exec /bin/sh -lc 'printf %s "${FIRSTMATE_HOME:-$HOME/.firstmate}"')
$firstMateHome = "$firstMateHome".Trim()
if ([string]::IsNullOrEmpty($firstMateHome)) {
    Write-Error "Could not ask $distro where the Host's home directory is."
    exit 1
}

$here      = Split-Path -Path $PSCommandPath -Parent
$trayHome  = Join-Path $env:LOCALAPPDATA 'FirstMate\Tray'
$startup   = Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate Tray.lnk'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'FirstMate.lnk'

# A running Tray holds the one-instance mutex and its own copy of these
# files, so it is stopped before they are replaced. Without this an install
# over a running Tray would copy the new files, start a second copy that
# leaves at once, and leave the old one running: an upgrade that silently
# does nothing.
$trayScript = Join-Path $trayHome 'firstmate-tray.ps1'
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($trayScript) })) {
    try {
        Stop-Process -Id $process.ProcessId -Force
        Write-Output "stopped the running Tray (pid $($process.ProcessId))"
    } catch {
        Write-Output "could not stop the Tray (pid $($process.ProcessId)): $_"
    }
}

New-Item -ItemType Directory -Path $trayHome -Force | Out-Null
foreach ($file in 'firstmate-tray.ps1', 'firstmate-open.ps1', 'firstmate-runtime.ps1',
                  'firstmate-hidden.vbs') {
    Copy-Item -Path (Join-Path $here $file) -Destination $trayHome -Force
}
# The icons left windows/ when they stopped being PowerShell's alone: they are
# packed with the program now. The Tray still draws with them until it retires.
$icons = Join-Path (Split-Path -Path $here -Parent) 'icons'
foreach ($file in 'firstmate-running.ico', 'firstmate-stopped.ico') {
    Copy-Item -Path (Join-Path $icons $file) -Destination $trayHome -Force
}
$shim = Join-Path $trayHome 'firstmate-hidden.vbs'
$values = '-Distro "{0}" -FirstMateHome "{1}"' -f $distro, $firstMateHome

# The Tray runs from the Windows filesystem, so it can start and answer
# honestly while the distribution is down. Only the shortcut knows where to
# look.
New-Shortcut -Path $startup -Target $shim `
    -Arguments "firstmate-tray.ps1 $values" `
    -Description 'FirstMate Tray'

# A door onto the Index Page that needs no Tray running at all.
New-Shortcut -Path $startMenu -Target $shim `
    -Arguments "firstmate-open.ps1 $values" `
    -Description 'Open the FirstMate Index Page'

Write-Output "FirstMate Tray installed."
Write-Output "  distribution:   $distro"
Write-Output "  FirstMate home: $firstMateHome"
Write-Output "  Tray Home:      $trayHome"
Write-Output "  Startup:        $startup"
Write-Output "  Start Menu:     $startMenu"
Write-Output ""
Write-Output "Nothing in the repository, the Registry, or a Plugin directory was touched."
Write-Output "Remove all of it with uninstall-tray.ps1."
Write-Output ""

# Start it now, so the icon is there before the next logon. It starts no Host.
Start-Process -FilePath $shim -ArgumentList "firstmate-tray.ps1 $values"

Write-Output "The icon is running now. On Windows 11 a new notification-area icon"
Write-Output "starts hidden: click the chevron (^) beside the clock and drag the"
Write-Output "FirstMate icon out to keep it on the taskbar."
