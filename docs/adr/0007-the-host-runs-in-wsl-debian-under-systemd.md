# The host runs in WSL Debian under systemd

The Host runs as a systemd service inside WSL Debian, with a Windows Task Scheduler entry at logon that starts WSL and holds the distribution up. WSL2 stops a distribution when its last process exits, so without that entry the Host would be awake only by accident; running natively on Windows instead would orphan the shell, the tools and the MCP servers that already live in Debian.

## Consequences

The Tray is a Windows process and the Host is a Linux process, so the two find each other through the filesystem and talk over loopback. The Host writes its port and token to `~/.firstmate/runtime.json`; the Tray reads that file over the `\\wsl.localhost\` path, and then reaches the Host at `127.0.0.1`, which WSL already forwards into the distribution. Nothing new carries traffic between the two halves.

Reading anything under `\\wsl.localhost\` starts a stopped distribution, so the Tray asks `wsl.exe` whether the distribution is running before it touches such a path, every time. Looking at FirstMate must not wake WSL.

The Tray was PowerShell when this decision was made and is a Node program now (ADR-0011). What is written here did not change with it: the split, the file, and loopback are the same. A notification-area icon is drawn by the process that creates it, and the distribution carries no tray host, no notification daemon and no panel, so the Windows half is where the icon has to live.
