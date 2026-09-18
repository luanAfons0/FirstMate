<#
    The Tray: the Windows notification-area icon that opens the Index Page,
    or any one Plugin Page from a menu of every Plugin, and starts or restarts
    the Host.

    It exists on Windows because WSLg hosts no notification area, so an icon
    inside the distribution would have nowhere to appear.

    It holds the Host's port and token in memory and opens the Index Page from
    there, so opening makes no wsl.exe call and no file read: nexus measured
    220-245 ms for one wsl.exe call, and opening a tool must not pay for it.
    That budget guards the open path alone. Restarting the Host is a deliberate
    click, and it spends one wsl.exe call knowingly.

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
# Longer than the probe that only asks a question: a restart stops every Plugin
# Server and starts it again, and systemd is entitled to take a moment over it.
$script:RestartTimeoutMs = 20000

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
        Ask the Host whether it is up and whether the token still opens it.

        A refused token means the run was replaced, so the runtime file is
        read again at once rather than at the next interval: the person is one
        click away from an address that would be refused. A Host that does not
        answer at all is read again no more than every RereadIntervalMs,
        because reading it crosses into the distribution.
    #>
    $answer = 'absent'
    if ($null -ne $script:Runtime) {
        $answer = Test-HostAdmits -Port $script:Runtime.Port -Token $script:Runtime.Token
    }

    if ($answer -ne 'running') {
        $since = ([DateTime]::UtcNow - $script:LastRead).TotalMilliseconds
        if ($answer -eq 'stale' -or $null -eq $script:Runtime -or $since -ge $script:RereadIntervalMs) {
            $script:LastRead = [DateTime]::UtcNow
            $found = Read-Runtime -Distro $Distro -FirstMateHome $FirstMateHome
            if ($null -ne $found) {
                $script:Runtime = $found
                $answer = Test-HostAdmits -Port $found.Port -Token $found.Token
            }
        }
    }

    $script:State = if ($answer -eq 'running') { 'running' } else { 'stopped' }
    $tray.Icon = $script:Icons[$script:State]
    $tray.Text = if ($script:State -eq 'running') {
        "FirstMate - running (port $($script:Runtime.Port))"
    } else {
        'FirstMate - the Host is not running'
    }
    $pluginsItem.Enabled = ($script:State -eq 'running')
}

function Restart-Host {
    <#
        Ask systemd inside the distribution to restart the Host. Returns $null
        when it did, and a sentence a person can act on when it did not.

        This is the one place the Tray may start something rather than only
        report it. Everywhere else it reflects a state it did not create, which
        is why the runtime file is never read without asking wsl.exe first.
        Here the person asked, so starting a stopped distribution is the point
        rather than an accident.
    #>
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = 'wsl.exe'
    $psi.Arguments              =
        ('-d "{0}" -- systemctl --user restart firstmate' -f $Distro)
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    # systemctl's own output comes through as the Linux process wrote it.
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

    try {
        $child = [System.Diagnostics.Process]::Start($psi)
    } catch {
        return "wsl.exe would not start: $($_.Exception.Message)"
    }
    # Read both streams while it runs. A unit that says a lot could otherwise
    # fill a pipe and wait for a reader that is itself waiting for the exit.
    $out = $child.StandardOutput.ReadToEndAsync()
    $err = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit($script:RestartTimeoutMs)) {
        try { $child.Kill() } catch { }
        return 'systemctl did not answer in time.'
    }
    if ($child.ExitCode -ne 0) {
        $why = $err.Result
        if ([string]::IsNullOrWhiteSpace($why)) { $why = $out.Result }
        if ([string]::IsNullOrWhiteSpace($why)) { $why = "exit $($child.ExitCode)" }
        return $why.Trim()
    }
    return $null
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

function New-StateDot {
    <#
        One Plugin's state, as a dot beside its name in the menu. Drawn for the
        same reason the icon is: the repository holds no binary asset. A Plugin
        with no Plugin Server gets a ring rather than a disc, so the state is
        shape as well as colour, exactly as the Index Page shows it.
    #>
    param([System.Drawing.Color] $Color, [bool] $Hollow = $false)
    $bitmap = New-Object System.Drawing.Bitmap 16, 16
    $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
    $canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $canvas.Clear([System.Drawing.Color]::Transparent)
    if ($Hollow) {
        $pen = New-Object System.Drawing.Pen $Color, 1.5
        $canvas.DrawEllipse($pen, 5, 5, 6, 6)
        $pen.Dispose()
    } else {
        $fill = New-Object System.Drawing.SolidBrush $Color
        $canvas.FillEllipse($fill, 5, 5, 6, 6)
        $fill.Dispose()
    }
    $canvas.Dispose()
    return $bitmap
}

# The Index Page's three colours, so one FirstMate says one thing.
$script:Dots = @{
    running            = New-StateDot ([System.Drawing.Color]::FromArgb(46, 160, 67))
    stopped            = New-StateDot ([System.Drawing.Color]::FromArgb(179, 38, 30))
    'no-plugin-server' = New-StateDot ([System.Drawing.Color]::FromArgb(140, 146, 154)) $true
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
# The Registry is read when the Host starts, so `firstmate add` and
# `firstmate remove` both end by saying to restart the Host. Until now the Tray
# could only print that sentence in a box and leave the person to type it. The
# label is settled when the menu opens, because which of the two it is depends
# on the state. It starts as the state starts: stopped.
$restartItem = $menu.Items.Add('Start FirstMate')
# Every Plugin, one click from the notification area. A Plugin Page is a whole
# page and the Host frames nothing (ADR-0008), so the Tray is where moving
# between Plugins without going through the Index Page belongs. It is a
# submenu rather than a run of items so that Quit never moves under the cursor.
$pluginsItem = $menu.Items.Add('Plugins')
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
        # What is in memory was admitted by the poll moments ago, so this is
        # one Start-Process and nothing else: no wsl.exe call and no file read.
        Start-Process (Get-IndexAddress -Runtime $script:Runtime)
    } catch {
        Show-Fault "FirstMate could not open the Index Page."
    }
}

function Invoke-Restart {
    <#
        Start the Host, or restart it, from the notification area.

        The Host mints a new token at every start, so the one held in memory is
        worth nothing the moment this returns. The state is read again at once
        rather than at the next poll, and LastRead is cleared first so that the
        throttle guarding the runtime file does not hold that read back. The
        poll behind it corrects anything a slow start still left wrong.
    #>
    $fault = Restart-Host
    if ($null -ne $fault) {
        Show-Fault ("FirstMate could not restart the Host.`n`n$fault`n`n" +
            "Run it inside $Distro by hand with:`n`n" +
            "    systemctl --user restart firstmate")
        return
    }
    $script:LastRead = [DateTime]::MinValue
    Update-State
}

function Get-PluginLabel {
    <#
        What the menu says about one Plugin: its name, and the Host's own word
        for it when that word is worth saying. A Running Plugin with a page has
        nothing surprising to report, so it reports nothing.
    #>
    param([Parameter(Mandatory = $true)] $Plugin)
    if (-not $Plugin.hasPage) { return "$($Plugin.name)    no Plugin Page" }
    if ($Plugin.state -eq 'stopped') { return "$($Plugin.name)    Stopped" }
    if ($Plugin.state -eq 'no-plugin-server') { return "$($Plugin.name)    no Plugin Server" }
    return [string] $Plugin.name
}

function Invoke-OpenPlugin {
    <#
        One Plugin Page in the Windows default browser. The address is built
        from what is already in memory, so this costs what Open costs: one
        Start-Process, no wsl.exe call and no file read.
    #>
    param([Parameter(Mandatory = $true)] [string] $Name)
    if ($script:State -ne 'running' -or $null -eq $script:Runtime) {
        Invoke-Open
        return
    }
    try {
        Start-Process (Get-PluginAddress -Runtime $script:Runtime -Name $Name)
    } catch {
        Show-Fault "FirstMate could not open the Plugin Page of $Name."
    }
}

function Update-PluginMenu {
    <#
        Fill the Plugins submenu from the Host, every time the menu opens.

        Asking on open rather than on the poll means the list is never stale
        and a Tray nobody clicks asks nothing. It is one loopback GET.
    #>
    $pluginsItem.DropDownItems.Clear()

    if ($script:State -ne 'running' -or $null -eq $script:Runtime) {
        $pluginsItem.Enabled = $false
        return
    }
    $plugins = @(Read-Plugins -Runtime $script:Runtime)
    if ($plugins.Count -eq 0) {
        # An empty Registry, or a Host that would not say. Either way there is
        # nothing to open, and a menu with nothing in it should not invite one.
        $pluginsItem.Enabled = $false
        return
    }
    $pluginsItem.Enabled = $true

    foreach ($plugin in $plugins) {
        $item = $pluginsItem.DropDownItems.Add((Get-PluginLabel -Plugin $plugin))
        $item.Image = $script:Dots[[string] $plugin.state]
        if (-not $plugin.hasPage) {
            # A Plugin with no Plugin Page has no address, so there is nowhere
            # for this item to go. It is still listed, because it still exists.
            $item.Enabled = $false
            continue
        }
        # A Stopped Plugin still serves its Plugin Page, so it keeps its item.
        $name = [string] $plugin.name
        $item.Add_Click({ Invoke-OpenPlugin -Name $name }.GetNewClosure())
    }
}

function Update-RestartLabel {
    <#
        What the restart item says, settled when the menu opens, exactly as the
        Plugins submenu is filled there and for the same reason.

        One item rather than two: a Host that is down is started and a Host
        that is up is restarted, and two items would leave one of them wrong at
        all times. It is enabled in both states, because starting a stopped
        distribution is what it is for.
    #>
    $restartItem.Text = if ($script:State -eq 'running') {
        'Restart FirstMate'
    } else {
        'Start FirstMate'
    }
}

$openItem.Add_Click({ Invoke-Open })
$restartItem.Add_Click({ Invoke-Restart })
$menu.Add_Opening({ Update-PluginMenu; Update-RestartLabel })
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
    foreach ($dot in $script:Dots.Values) { $dot.Dispose() }
    $script:Instance.ReleaseMutex()
    $script:Instance.Dispose()
}
