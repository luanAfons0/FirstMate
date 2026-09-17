<#
    Open the Index Page from Windows, with no Tray in the picture: the Start
    Menu shortcut points here through the shim.

    It reads the Host's runtime file once and opens the address it describes.
    Unlike the Tray it holds nothing in memory, because it lives for one click.
#>
[CmdletBinding()]
param(
    # The WSL distribution the Host runs in, e.g. Debian.
    [Parameter(Mandatory = $true)] [string] $Distro,
    # The Host's home directory as the distribution sees it.
    [Parameter(Mandatory = $true)] [string] $FirstMateHome
)

Set-StrictMode -Version 2.0

. (Join-Path $PSScriptRoot 'firstmate-runtime.ps1')

$runtime = Read-Runtime -Distro $Distro -FirstMateHome $FirstMateHome
if ($null -ne $runtime -and (Test-HostAdmits -Port $runtime.Port -Token $runtime.Token) -eq 'running') {
    Start-Process (Get-IndexAddress -Runtime $runtime)
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
    ("The FirstMate Host is not running.`n`n" +
     "Start it inside $Distro with:`n`n    systemctl --user start firstmate"),
    'FirstMate', [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
exit 1
