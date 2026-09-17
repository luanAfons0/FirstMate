# Run the Host as a service

The Host is a Linux process inside WSL Debian and the Tray is a Windows
process, so keeping it running takes one thing on each side (ADR-0007):

1. a **systemd user service** inside Debian, which runs the Host;
2. a **Task Scheduler entry at logon** on Windows, which starts WSL and holds
   the distribution up, because WSL2 stops a distribution when its last process
   exits.

Install the Debian half first. Without it the Windows half starts a
distribution that runs nothing.

## Debian: the systemd user service

Install:

```sh
scripts/install-service.sh
```

It writes one file, `~/.config/systemd/user/firstmate.service`, filled in with
the path of this repository and the path of `node`. It then enables the service,
starts it, and enables lingering so that the Host runs without an interactive
login.

Remove:

```sh
scripts/uninstall-service.sh
```

Read what it is doing:

```sh
systemctl --user status firstmate
journalctl --user -u firstmate -f
```

The journal holds the Host's output and every Plugin Server's output with it.
The Host keeps no logs of its own (ADR-0005).

Stop it, start it, restart it after editing a Plugin:

```sh
systemctl --user stop firstmate
systemctl --user start firstmate
systemctl --user restart firstmate
```

A Plugin is read at start, so restarting the Host is how a new Plugin or a
changed one is picked up.

## Windows: the logon task

Run this once, from Windows PowerShell, from this repository over
`\\wsl.localhost\`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  \\wsl.localhost\Debian\home\<user>\.first-mate\windows\install-logon-task.ps1
```

It works out the distribution from the path it is run from. It writes two
places: `%LOCALAPPDATA%\FirstMate`, holding a copy of the holder and the launch
shim, and one Task Scheduler entry named `FirstMate Host`.

Start it now, without logging out:

```powershell
Start-ScheduledTask -TaskName 'FirstMate Host'
```

Remove it:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  \\wsl.localhost\Debian\home\<user>\.first-mate\windows\uninstall-logon-task.ps1
```

See it:

```powershell
Get-ScheduledTask -TaskName 'FirstMate Host'
Get-ScheduledTaskInfo -TaskName 'FirstMate Host'
```

## Prove it

After logging out of Windows and back in, with nothing started by hand:

```sh
systemctl --user is-active firstmate     # active
cat ~/.firstmate/runtime.json            # the port and the token
curl "http://127.0.0.1:4747/?token=$(python3 -c 'import json;print(json.load(open("'"$HOME"'/.firstmate/runtime.json"))["token"])')"
```

The Tray opens the same address without any of that typing (issue #9).
