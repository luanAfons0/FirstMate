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
firstmate service on        # from an npm install
node src/cli.ts service on  # from a clone
```

It writes one file, `~/.config/systemd/user/firstmate.service` (under
`$XDG_CONFIG_HOME` when that is set). The unit starts the program that ran the
command, with the absolute path of the `node` that ran it: the service's PATH
has no nvm, so a bare `node` there can be an older one. From an npm install it
starts the package's `dist/main.js`; from a clone, the clone's `src/main.ts`.
It then enables the service, starts it, and enables lingering so that the Host
runs without an interactive login. It refuses a Node older than 24.

Run it again after a new Node or a new install: it writes the unit again.

When `loginctl` refuses to enable lingering, it says so and gives the command
to run by hand: `sudo loginctl enable-linger <user>`.

Remove:

```sh
firstmate service off
```

It stops and disables the service and removes exactly the unit file. It leaves
lingering on, because other services can depend on it.

Where there is no systemd, both say so and do nothing. Run the Host with
`firstmate start` instead.

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

Inside WSL, `firstmate service on` ends by printing the one command that
installs the logon task from where FirstMate really is, and `firstmate service
off` prints the one that removes it. They only print: a command inside WSL does
not write Windows state. Run the printed command once, from Windows PowerShell.

From an npm install, the scripts are in the package's own `windows/` directory,
so the command is of this form:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  \\wsl.localhost\Debian\<npm prefix>\lib\node_modules\@luan-afonso\firstmate\windows\install-logon-task.ps1
```

From a clone, it names the clone's `windows/` directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  \\wsl.localhost\Debian\home\<user>\.first-mate\windows\install-logon-task.ps1
```

It works out the distribution from the path it is run from. It writes two
places: `%LOCALAPPDATA%\FirstMate`, holding a copy of the holder and the launch
shim, and one Task Scheduler entry named `FirstMate Host`.

The logon task is not the Tray's "Start at logon". The task holds WSL up so
that the Host runs; the Tray's entry starts the window.

Start it now, without logging out:

```powershell
Start-ScheduledTask -TaskName 'FirstMate Host'
```

Remove it with the command `firstmate service off` prints, which runs
`uninstall-logon-task.ps1` from the same `windows/` directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  \\wsl.localhost\Debian\<path to FirstMate>\windows\uninstall-logon-task.ps1
```

See it:

```powershell
Get-ScheduledTask -TaskName 'FirstMate Host'
Get-ScheduledTaskInfo -TaskName 'FirstMate Host'
```

## Windows: the Tray

The Tray is FirstMate's Windows program: a notification-area icon and a window
of FirstMate's own. It needs Node 24 on Windows.

Install, from Windows PowerShell:

```powershell
npm install -g @luan-afonso/firstmate
firstmate desktop
```

`firstmate desktop` works out the distribution and the Host's home directory
itself, so there is nothing to type beyond that. It asks the distribution once,
the first time it needs to, and every later run finds the same runtime file on
its own (see "Open it from Windows" in `README.md`).

Turn on start at logon from the icon's own menu, "Start at logon".

Update it the same way:

```powershell
npm install -g @luan-afonso/firstmate
```

Quit the Tray first, from the icon's menu. `npm install -g` replaces the whole
package directory the program runs out of, and a running program holds those
files open.

Run the code in this repository instead of the published package:

```sh
# in WSL, inside the repository
npm pack --pack-destination /tmp
```

```powershell
# on Windows, over \\wsl.localhost\
npm install -g \\wsl.localhost\Debian\tmp\luan-afonso-firstmate-<version>.tgz
```

Remove it:

1. Turn "Start at logon" off from the icon's menu.
2. Quit the Tray, from the icon's menu.
3. `npm uninstall -g @luan-afonso/firstmate`
4. Remove the registry key the Tray writes so its Windows pop-ups say
   "FirstMate" and wear its mark (`src/notice-helper.ts`). Nothing removes it
   on its own:

   ```powershell
   Remove-Item -LiteralPath 'HKCU:\Software\Classes\AppUserModelId\LuanAfonso.FirstMate' -Recurse -Force
   ```

What the icon does:

| Action           | What happens                                                |
| ---------------- | ----------------------------------------------------------- |
| Click            | Opens the window, on the Index Page or where it last was.    |
| Open FirstMate   | The same.                                                    |
| Plugins          | Every Plugin and its state. Opens any one in the window.     |
| Start, Restart   | Asks systemd inside the distribution. The label says which.  |
| Start at logon   | Writes or removes one file in the Startup folder.            |
| Quit             | Removes the icon. The Host keeps running.                    |

The anchor is green when the Host answered and admitted the program's token, and
grey when it did not. The tooltip names the state and, when running, the port.

The program asks the Host itself rather than only asking whether the port is
open, because the port is fixed and the token is not: the Host mints a new one
at every start, so a run can end and be replaced without the port ever stopping
answering. A refused token sends the program back to the runtime file at once,
and the window returns to the page it was on at the address the new run answers.

Reading that file crosses into the distribution, so a Host that does not answer
at all is read again no more than every thirty seconds, and `wsl.exe` is asked
whether the distribution is running before any path into it is touched. Looking
at FirstMate does not wake WSL.

Start at logon is one file, `FirstMate.vbs` in the Startup folder. The menu
writes it, and turning the toggle off deletes exactly that file. Nothing is
scheduled, and the toggle writes nothing to the registry. The one key the Tray
writes is the one its pop-ups need, in step 4 above.

On Windows 11 a new notification-area icon starts hidden: click the chevron
(`^`) beside the clock and drag the FirstMate icon out to keep it on the
taskbar.

## Prove it

After logging out of Windows and back in, with nothing started by hand:

```sh
systemctl --user is-active firstmate     # active
cat ~/.firstmate/runtime.json            # the port and the token
curl "http://127.0.0.1:4747/?token=$(python3 -c 'import json;print(json.load(open("'"$HOME"'/.firstmate/runtime.json"))["token"])')"
```

The Tray opens the same address without any of that typing (issue #9).
