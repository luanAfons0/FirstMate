<#
    Hold the WSL distribution up for as long as Windows is logged in.

    WSL2 stops a distribution when its last process exits, so without this the
    Host would be awake only by accident (ADR-0007). This starts the
    distribution, which starts systemd, which starts the Host, and then holds
    one process open inside it and waits.

    The Task Scheduler entry at logon runs this through firstmate-hidden.vbs,
    so it never shows a window. Run it by hand to see what it does:

      powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        \\wsl.localhost\<Distro>\<path to FirstMate>\windows\hold-distribution.ps1 `
        -Distro Debian
#>
[CmdletBinding()]
param(
    # The WSL distribution the Host lives in, e.g. Debian.
    [Parameter(Mandatory = $true)] [string] $Distro
)

Set-StrictMode -Version 2.0

# One process inside the distribution, for as long as this one lives. It costs
# nothing and it is the whole job: everything else in there is systemd's.
& wsl.exe -d $Distro --exec /usr/bin/sleep infinity
exit $LASTEXITCODE
