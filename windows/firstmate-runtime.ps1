<#
    What the Windows side knows about the Host, and how it finds it out.

    The Host is a Linux process and the Tray is a Windows one, so the two meet
    at one file: the Host writes its port and its token to runtime.json in its
    home directory, and Windows reads that file over the \\wsl.localhost\ path
    (ADR-0007).

    This file is dot-sourced by firstmate-tray.ps1 and firstmate-open.ps1. It
    holds no state and opens no listener of its own.
#>

Set-StrictMode -Version 2.0

function Get-RuntimeFilePath {
    <#
        The Windows path of the Host's runtime file.
        /home/luanh/.firstmate becomes
        \\wsl.localhost\Debian\home\luanh\.firstmate\runtime.json.
    #>
    param(
        [Parameter(Mandatory = $true)] [string] $Distro,
        [Parameter(Mandatory = $true)] [string] $FirstMateHome
    )
    return "\\wsl.localhost\$Distro" + ($FirstMateHome -replace '/', '\') + '\runtime.json'
}

function Test-DistroRunning {
    <#
        True when Windows already has the distribution running.

        This is asked before the runtime file is read, because reading anything
        under \\wsl.localhost\ starts a stopped distribution. The Tray shows the
        state, it does not create it, and `wsl.exe --list --running` starts
        nothing.
    #>
    param([Parameter(Mandatory = $true)] [string] $Distro)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = 'wsl.exe'
    $psi.Arguments              = '--list --running --quiet'
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    # wsl.exe writes its own listings in UTF-16. Reading as UTF-8 and dropping
    # NULs reads the ASCII of a distribution name correctly.
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8

    try {
        $child = [System.Diagnostics.Process]::Start($psi)
    } catch {
        return $false
    }
    $out = $child.StandardOutput.ReadToEndAsync()
    if (-not $child.WaitForExit(10000)) {
        try { $child.Kill() } catch { }
        return $false
    }
    if ($child.ExitCode -ne 0) { return $false }
    foreach ($name in (($out.Result -replace "`0", '') -split "`r?`n")) {
        if ($name.Trim() -eq $Distro) { return $true }
    }
    return $false
}

function Read-Runtime {
    <#
        The port and the token the Host last wrote, or $null when there is no
        run to read: the distribution is down, the Host never started, or it
        stopped and took its runtime file with it.
    #>
    param(
        [Parameter(Mandatory = $true)] [string] $Distro,
        [Parameter(Mandatory = $true)] [string] $FirstMateHome
    )

    if (-not (Test-DistroRunning -Distro $Distro)) { return $null }

    $path = Get-RuntimeFilePath -Distro $Distro -FirstMateHome $FirstMateHome
    try {
        $text = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
        $runtime = $text | ConvertFrom-Json
    } catch {
        return $null
    }
    # Strict mode makes a missing property an error, so the names are looked
    # for rather than read. A half-written runtime file is no run.
    if ($null -eq $runtime) { return $null }
    $names = @($runtime.PSObject.Properties.Name)
    if ($names -notcontains 'port' -or $names -notcontains 'token') { return $null }
    if (-not $runtime.port -or -not $runtime.token) { return $null }
    return [pscustomobject]@{ Port = [int] $runtime.port; Token = [string] $runtime.token }
}

function Test-HostAdmits {
    <#
        Whether the Host answers on this port and admits this token.

        A TCP connection proves that something is listening. It does not prove
        that the token in hand still opens it, and those are different
        questions: the Host mints a new token at every start and keeps the
        same port, so a run can end and be replaced without the port ever
        stopping answering. Asking the Host itself is the only honest check.

        Returns one of:

          running  the Host answered and let us in
          stale    the Host answered and refused the token: a new run
          absent   nothing answered

        WSL2 forwards 127.0.0.1 into the distribution, so this asks from
        Windows with no wsl.exe call and no file read.
    #>
    param(
        [Parameter(Mandatory = $true)] [int] $Port,
        [Parameter(Mandatory = $true)] [string] $Token,
        [int] $TimeoutMs = 2000
    )

    $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/?token=$Token")
    # A HEAD asks the question without carrying the page back, and no proxy
    # stands between this process and its own loopback.
    $request.Method           = 'HEAD'
    $request.Proxy            = $null
    $request.Timeout          = $TimeoutMs
    $request.ReadWriteTimeout = $TimeoutMs
    $request.AllowAutoRedirect = $false
    try {
        $request.GetResponse().Close()
        return 'running'
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return 'absent' }
        $code = [int] $response.StatusCode
        $response.Close()
        if ($code -eq 403) { return 'stale' }
        # It answered. Whatever it disliked about that one address, the Host
        # is up and this token reaches it.
        return 'running'
    } catch {
        return 'absent'
    }
}

function Get-IndexAddress {
    <#
        The address of the Index Page, with the token on it once. The Host
        answers it with a cookie and sends the browser to the clean address, so
        this is the only place the token is ever typed.
    #>
    param([Parameter(Mandatory = $true)] $Runtime)
    return "http://127.0.0.1:$($Runtime.Port)/?token=$($Runtime.Token)"
}

function Get-PluginAddress {
    <#
        The address of one Plugin Page, with the token on it once, exactly as
        the Index Page address carries it.
    #>
    param(
        [Parameter(Mandatory = $true)] $Runtime,
        [Parameter(Mandatory = $true)] [string] $Name
    )
    $escaped = [System.Uri]::EscapeDataString($Name)
    return "http://127.0.0.1:$($Runtime.Port)/p/$escaped/?token=$($Runtime.Token)"
}

function Read-Plugins {
    <#
        Every Plugin the Host knows, or $null when it will not say.

        The Host serves the Index Page for a person and /plugins.json for the
        Tray, which cannot read a page. This is one loopback GET, the same trip
        the poll already makes: no wsl.exe call and no file read.
    #>
    param(
        [Parameter(Mandatory = $true)] $Runtime,
        [int] $TimeoutMs = 2000
    )

    $address = "http://127.0.0.1:$($Runtime.Port)/plugins.json?token=$($Runtime.Token)"
    $request = [System.Net.HttpWebRequest]::Create($address)
    $request.Method            = 'GET'
    $request.Proxy             = $null
    $request.Timeout           = $TimeoutMs
    $request.ReadWriteTimeout  = $TimeoutMs
    $request.AllowAutoRedirect = $false
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader $response.GetResponseStream()
        $text = $reader.ReadToEnd()
        $reader.Close()
        $response.Close()
        $answer = $text | ConvertFrom-Json
    } catch {
        return $null
    }
    # Strict mode makes a missing property an error, so the name is looked for
    # rather than read, exactly as the runtime file is.
    if ($null -eq $answer) { return $null }
    if (@($answer.PSObject.Properties.Name) -notcontains 'plugins') { return $null }
    return @($answer.plugins)
}
