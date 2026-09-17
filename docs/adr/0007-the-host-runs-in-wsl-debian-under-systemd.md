# The host runs in WSL Debian under systemd

The Host runs as a systemd service inside WSL Debian, with a Windows Task Scheduler entry at logon that starts WSL and holds the distribution up. WSL2 stops a distribution when its last process exits, so without that entry the Host would be awake only by accident; running natively on Windows instead would orphan the shell, the tools and the MCP servers that already live in Debian.

## Consequences

The Tray is a Windows PowerShell process and the Host is a Linux process, so the two communicate through the filesystem: the Host writes its port and token to `~/.firstmate/runtime.json`, and the Tray reads that file over the `\\wsl.localhost\` path.
