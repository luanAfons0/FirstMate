<#
    The Tray: the Windows notification-area icon that opens the Index Page.

    It exists on Windows because WSLg hosts no notification area, so an icon
    inside the distribution would have nowhere to appear.

    It holds the Host's port and token in memory and opens the Index Page from
    there, so opening makes no wsl.exe call and no file read: nexus measured
    220-245 ms for one wsl.exe call, and opening a tool must not pay for it.

    It polls by asking the Host's own port whether anything answers, which
    costs nothing. Only when that fails does it look at the runtime file again,
    and only after asking wsl.exe whether the distribution is running at all,
    because reading anything under \\wsl.localhost\ would start a stopped one.

    Launch it by hand:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<home>\.first-mate\windows\firstmate-tray.ps1 `
        -Distro Debian -FirstMateHome /home/<user>/.firstmate
#>
[CmdletBinding()]
param(
    # The WSL distribution the Host runs in, e.g. Debian.
    [string] $Distro,
    # The Host's home directory as the distribution sees it.
    [string] $FirstMateHome
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'firstmate-runtime.ps1')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Asking the port costs nothing, so the icon can be honest every few seconds.
$script:PollIntervalMs = 5000
# Reading the runtime file crosses into the distribution, so it is done only
# when the port has stopped answering, and at most this often.
$script:RereadIntervalMs = 30000

# --- where the Host is ----------------------------------------------------

function Show-Fault {
    param([string] $Message)
    [System.Windows.Forms.MessageBox]::Show(
        $Message, 'FirstMate', [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

function Get-TraySource {
    <#
        The distribution and the Host's home, read out of the path this script
        is running from. `\\wsl.localhost\Debian\home\luanh\.first-mate\windows\
        firstmate-tray.ps1` names the first and implies the second; a copy in
        the Tray Home names neither, so the installer passes both.
    #>
    param([string] $Path)
    if ([string]::IsNullOrEmpty($Path)) { return $null }
    if ($Path -notmatch '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.+)$') { return $null }
    $posix = '/' + ($Matches[2] -replace '\\', '/')
    $repository = $posix -replace '/windows/[^/]+$', ''
    return [pscustomobject]@{
        Distro        = $Matches[1]
        FirstMateHome = ($repository -replace '/[^/]+$', '') + '/.firstmate'
    }
}

if (-not $Distro -or -not $FirstMateHome) {
    $source = Get-TraySource -Path $PSCommandPath
    if ($null -eq $source) {
        Show-Fault ("FirstMate cannot tell which distribution to look in.`n`n" +
            "Run the Tray from the repository over \\wsl.localhost\, or pass " +
            "-Distro and -FirstMateHome.")
        exit 2
    }
    if (-not $Distro)        { $Distro        = $source.Distro }
    if (-not $FirstMateHome) { $FirstMateHome = $source.FirstMateHome }
}

# --- the state ------------------------------------------------------------

# running or stopped, and the run the Tray last saw. The address carries the
# token, so it is held in memory and written to no file on the Windows side.
$script:State    = 'stopped'
$script:Runtime  = $null
$script:LastRead = [DateTime]::MinValue

function Update-State {
    <#
        Ask the Host's port, and go back to the runtime file only when the port
        says nothing. A run that restarted on another port is found by the
        re-read; a distribution that is down is found by Read-Runtime without
        being started.
    #>
    if ($null -ne $script:Runtime -and (Test-HostListening -Port $script:Runtime.Port)) {
        $script:State = 'running'
    } else {
        $since = ([DateTime]::UtcNow - $script:LastRead).TotalMilliseconds
        if ($null -eq $script:Runtime -or $since -ge $script:RereadIntervalMs) {
            $script:LastRead = [DateTime]::UtcNow
            $found = Read-Runtime -Distro $Distro -FirstMateHome $FirstMateHome
            if ($null -ne $found) { $script:Runtime = $found }
        }
        $script:State =
            if ($null -ne $script:Runtime -and (Test-HostListening -Port $script:Runtime.Port)) {
                'running'
            } else {
                'stopped'
            }
    }

    $tray.Icon = $script:Icons[$script:State]
    $tray.Text = if ($script:State -eq 'running') {
        "FirstMate - running (port $($script:Runtime.Port))"
    } else {
        'FirstMate - the Host is not running'
    }
    $copyItem.Enabled = ($script:State -eq 'running')
}

# --- the icon -------------------------------------------------------------

function New-StateIcon {
    <#
        One icon, drawn here rather than shipped, so the repository holds no
        binary asset. Both are made at startup and kept for the life of the
        process; nothing draws one per poll.
    #>
    param([System.Drawing.Color] $Color)
    $bitmap = New-Object System.Drawing.Bitmap 16, 16
    $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
    $canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $canvas.Clear([System.Drawing.Color]::Transparent)
    $fill = New-Object System.Drawing.SolidBrush $Color
    $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 0, 0, 0)), 1
    $canvas.FillEllipse($fill, 1, 1, 14, 14)
    $canvas.DrawEllipse($edge, 1, 1, 13, 13)
    $fill.Dispose(); $edge.Dispose(); $canvas.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    $bitmap.Dispose()
    return $icon
}

$script:Icons = @{
    running = New-StateIcon ([System.Drawing.Color]::FromArgb(46, 160, 67))
    stopped = New-StateIcon ([System.Drawing.Color]::FromArgb(130, 134, 139))
}

# --- start at logon -------------------------------------------------------

function Get-StartupShortcutPath {
    return Join-Path ([Environment]::GetFolderPath('Startup')) 'FirstMate Tray.lnk'
}

function Get-ShimPath {
    # The shim beside this script, which starts it with no window. An installed
    # Tray has one; a Tray run straight from the repository does not, and so
    # cannot write the shortcut.
    return Join-Path $PSScriptRoot 'firstmate-hidden.vbs'
}

function Set-StartAtLogon {
    param([bool] $Enabled)
    $path = Get-StartupShortcutPath
    if (-not $Enabled) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        return
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath       = Get-ShimPath
    $link.Arguments        =
        ('firstmate-tray.ps1 -Distro "{0}" -FirstMateHome "{1}"' -f $Distro, $FirstMateHome)
    $link.WorkingDirectory = $PSScriptRoot
    $link.Description      = 'FirstMate Tray'
    $link.Save()
}

# --- one instance ---------------------------------------------------------

# A second launch must not add a second icon. The mutex is checked before
# anything is shown, so the second process leaves at once and silently.
$created = $false
$script:Instance = New-Object System.Threading.Mutex($true, 'Local\FirstMateTray', [ref] $created)
if (-not $created) { exit 0 }

# --- the tray -------------------------------------------------------------

[System.Windows.Forms.Application]::EnableVisualStyles()

$menu = New-Object System.Windows.Forms.ContextMenuStrip
# Open first and bold: it is the whole point of the icon, and it is what a
# double-click does.
$openItem = $menu.Items.Add('Open FirstMate')
$openItem.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$copyItem = $menu.Items.Add('Copy address')
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$logonItem = $menu.Items.Add('Start at logon')
$logonItem.Checked = (Test-Path -LiteralPath (Get-StartupShortcutPath))
$logonItem.Enabled = (Test-Path -LiteralPath (Get-ShimPath))
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$quitItem = $menu.Items.Add('Quit')

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $script:Icons['stopped']
$tray.Text = 'FirstMate - the Host is not running'
$tray.ContextMenuStrip = $menu
$tray.Visible = $true

$context = New-Object System.Windows.Forms.ApplicationContext

function Invoke-Open {
    <#
        The Index Page in the Windows default browser. The address is already
        in memory, so this is one Start-Process and nothing else: no wsl.exe
        call, no file read, no round trip into the distribution.
    #>
    if ($script:State -ne 'running' -or $null -eq $script:Runtime) {
        Show-Fault ("The FirstMate Host is not running.`n`n" +
            "Start it inside $Distro with:`n`n    systemctl --user start firstmate`n`n" +
            "If the distribution itself is down, logging out and back in starts it.")
        Update-State
        return
    }
    try {
        Start-Process (Get-IndexAddress -Runtime $script:Runtime)
    } catch {
        Show-Fault "FirstMate could not open the Index Page."
    }
}

function Invoke-CopyAddress {
    <#
        The address, token and all, on the clipboard. That is the one place the
        token goes on the Windows side, and it goes there because the person
        asked: it is written to no file.
    #>
    if ($script:State -ne 'running' -or $null -eq $script:Runtime) { return }
    try {
        [System.Windows.Forms.Clipboard]::SetText((Get-IndexAddress -Runtime $script:Runtime))
    } catch {
        Show-Fault 'FirstMate could not reach the clipboard.'
    }
}

$openItem.Add_Click({ Invoke-Open })
$copyItem.Add_Click({ Invoke-CopyAddress })
$logonItem.Add_Click({
    try {
        Set-StartAtLogon (-not $logonItem.Checked)
    } catch {
        Show-Fault ("FirstMate could not change the Startup shortcut.`n`n" + $_)
    }
    $logonItem.Checked = (Test-Path -LiteralPath (Get-StartupShortcutPath))
})
# One gesture for the one action.
$tray.Add_DoubleClick({ Invoke-Open })

$quitItem.Add_Click({
    # Hide and dispose before the context exits, or a dead icon lingers in the
    # notification area until someone hovers it. Quitting the icon stops no
    # Host: it is a door, not the run.
    $timer.Stop()
    $tray.Visible = $false
    $tray.Dispose()
    $context.ExitThread()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $script:PollIntervalMs
$timer.Add_Tick({ Update-State })

Update-State
$timer.Start()

try {
    [System.Windows.Forms.Application]::Run($context)
} finally {
    $timer.Dispose()
    $tray.Dispose()
    foreach ($icon in $script:Icons.Values) { $icon.Dispose() }
    $script:Instance.ReleaseMutex()
    $script:Instance.Dispose()
}
