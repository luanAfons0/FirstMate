<#
    Install the Tray on Windows. Run it once, from Windows, from this
    repository over \\wsl.localhost\:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\install-tray.ps1

    The Tray is a Node program now, and it ships in the FirstMate package, so
    this installs that package on Windows rather than copying scripts about.
    It writes exactly two places outside the package:

      1. the FirstMate Home on Windows, %LOCALAPPDATA%\FirstMate, which gets
         one launcher that starts the program with no window;
      2. the Start Menu, which gets a shortcut to that launcher.

    Start at logon is the program's own, from the icon's menu. This writes no
    Startup entry, so that one file decides it and one menu item changes it.

    It works out the distribution from the path it is running from, and asks
    the distribution once where the Host's home directory is, so that nothing
    here is hardcoded and no configuration file is written.

    uninstall-tray.ps1 removes exactly what this wrote.
#>
[CmdletBinding()]
param(
    # Install the package from this repository rather than from the registry.
    # A contributor wants their own code; everybody else wants the published one.
    [switch] $FromHere
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Package = '@luan-afonso/firstmate'

function Get-Source {
    <#
        The distribution and the repository, read out of the path this script
        is running from. `\\wsl.localhost\Debian\home\luanh\.first-mate\windows\
        install-tray.ps1` names the first and spells out the second.
    #>
    param([string] $Path)
    if ([string]::IsNullOrEmpty($Path)) { return $null }
    if ($Path -notmatch '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.+)$') { return $null }
    $posix = '/' + ($Matches[2] -replace '\\', '/')
    return [pscustomobject]@{
        Distro     = $Matches[1]
        Repository = ($posix -replace '/windows/[^/]+$', '')
    }
}

function New-Shortcut {
    param(
        [string] $Path, [string] $Target, [string] $Arguments, [string] $Description,
        # Without this a shortcut wears its target's icon, and the target is a
        # script host: the Start Menu then shows FirstMate as a generic script.
        [string] $Icon
    )
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath       = $Target
    $link.Arguments        = $Arguments
    $link.WorkingDirectory = Split-Path -Path $Target -Parent
    $link.Description      = $Description
    if ($Icon) { $link.IconLocation = $Icon }
    $link.Save()
}

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

$source = Get-Source -Path $PSCommandPath
if ($null -eq $source) {
    Write-Error ("Run this from the repository over \\wsl.localhost\, so that it can tell " +
        "which distribution holds the Host. It is at " +
        "\\wsl.localhost\<Distro>\<home>\.first-mate\windows\install-tray.ps1.")
    exit 1
}
$distro = $source.Distro

# The Host's home directory, from the Host's own rule: FIRSTMATE_HOME, or
# ~/.firstmate. Asked once, here, so that the Tray never has to ask.
$firstMateHome = (& wsl.exe -d $distro --exec /bin/sh -lc 'printf %s "${FIRSTMATE_HOME:-$HOME/.firstmate}"')
$firstMateHome = "$firstMateHome".Trim()
if ([string]::IsNullOrEmpty($firstMateHome)) {
    Write-Error "Could not ask $distro where the Host's home directory is."
    exit 1
}

# A running Tray holds the launcher it was started from, so it stops before
# the package under it is replaced. Without this an upgrade would leave the old
# program running against the new files.
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '\bdesktop\b' -and
                   $_.CommandLine -match 'firstmate' })) {
    try {
        Stop-Process -Id $process.ProcessId -Force
        Write-Output "stopped the running Tray (pid $($process.ProcessId))"
    } catch {
        Write-Output "could not stop the Tray (pid $($process.ProcessId)): $_"
    }
}

Remove-OldTray

Write-Output "Installing $Package on Windows..."
if ($FromHere) {
    # npm mangles a \\wsl.localhost\ path, so the repository is packed inside
    # the distribution, where it is an ordinary directory, and the tarball is
    # carried out.
    #
    # The distribution is asked where its own npm is, because a login shell
    # inherits Windows' PATH through interop and finds Windows' npm first. That
    # npm would then try to build the repository over a UNC path and fail on
    # its own doubled path. Only an interactive shell sources a version manager,
    # which is where a Linux npm usually lives.
    $npm = "$(& wsl.exe -d $distro --exec /bin/bash -ic 'command -v npm 2>/dev/null')".Trim()
    if ($npm -like '/mnt/*' -or [string]::IsNullOrEmpty($npm)) {
        Write-Error ("Could not find an npm inside $distro. " +
            "Install Node there, or leave off -FromHere to install the published package.")
        exit 1
    }
    # npm's own shebang asks for `node`, and under a plain shell that is Windows'
    # node through interop, which then builds over a UNC path and fails. Its own
    # bin directory goes first on PATH so that it finds the node beside it.
    $bin = ($npm -replace '/[^/]+$', '')
    $tarball = "$(& wsl.exe -d $distro --exec /bin/sh -c `
        ("PATH='{0}':`$PATH exec '{1}' pack '{2}' --pack-destination /tmp --silent" -f `
            $bin, $npm, $source.Repository))".Trim()
    if ([string]::IsNullOrEmpty($tarball)) {
        Write-Error "Could not pack $($source.Repository) inside $distro with $npm."
        exit 1
    }
    $carried = Join-Path $env:TEMP $tarball
    Copy-Item -Path "\\wsl.localhost\$distro\tmp\$tarball" -Destination $carried -Force
    & npm.cmd install --global --no-fund --no-audit $carried
} else {
    & npm.cmd install --global --no-fund --no-audit $Package
}
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm could not install $Package. Install Node 24 on Windows and try again."
    exit 1
}

# Where npm put it. The program is started through node.exe directly rather
# than through the .cmd shim, because the shim is a batch file and a batch file
# opens a console.
$prefix = (& npm.cmd prefix --global).Trim()
$entry = Join-Path $prefix 'node_modules\@luan-afonso\firstmate\dist\cli.js'
if (-not (Test-Path -LiteralPath $entry)) {
    Write-Error "npm reported success but $entry is not there."
    exit 1
}
$icon = Join-Path $prefix 'node_modules\@luan-afonso\firstmate\icons\firstmate-running.ico'

$home_ = Join-Path $env:LOCALAPPDATA 'FirstMate'
New-Item -ItemType Directory -Path $home_ -Force | Out-Null
$launcher = Join-Path $home_ 'firstmate-window.vbs'

# The program is a console program, so a shortcut to it would flash a console.
# The script host starts it with no window at all. The program writes a file of
# exactly this shape into Startup when start at logon is turned on.
$node = (Get-Command node.exe -ErrorAction Stop).Source
$command = '"{0}" "{1}" desktop --distribution "{2}" --home "{3}"' -f `
    $node, $entry, $distro, $firstMateHome
$vbs = @"
' The FirstMate window, started with no window of its own to flash.
'
' install-tray.ps1 wrote this. uninstall-tray.ps1 removes it. It is the same
' shape the program writes into Startup when start at logon is turned on.

Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "$($command -replace '"', '""')", 0, False
"@
Set-Content -LiteralPath $launcher -Value $vbs -Encoding ASCII

# Start at logon is the program's own, and this does not turn it on. But an
# entry already there names wherever the program was when it was written, and
# the program has just moved, so it is pointed at the copy that now exists.
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate.vbs'
if (Test-Path -LiteralPath $startup) {
    Set-Content -LiteralPath $startup -Value $vbs -Encoding ASCII
    Write-Output "start at logon was already on, and now names the copy just installed"
}

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'FirstMate.lnk'
New-Shortcut -Path $startMenu -Target (Join-Path $env:WINDIR 'System32\wscript.exe') `
    -Arguments ('"{0}"' -f $launcher) `
    -Description 'FirstMate' -Icon $icon

Write-Output "FirstMate installed."
Write-Output "  distribution:   $distro"
Write-Output "  FirstMate home: $firstMateHome"
Write-Output "  program:        $entry"
Write-Output "  launcher:       $launcher"
Write-Output "  Start Menu:     $startMenu"
Write-Output ""
Write-Output "Nothing in the repository, the Registry, or a Plugin directory was touched."
Write-Output "Remove all of it with uninstall-tray.ps1."
Write-Output ""

Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"{0}"' -f $launcher)

Write-Output "FirstMate is running now. On Windows 11 a new notification-area icon"
Write-Output "starts hidden: click the chevron (^) beside the clock and drag the"
Write-Output "FirstMate icon out to keep it on the taskbar."
Write-Output ""
Write-Output "To have it come back after a reboot, turn on Start at logon from the"
Write-Output "icon's own menu. That is one file, and the menu is what writes it."
