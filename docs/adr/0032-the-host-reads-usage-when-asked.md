# The Host reads Usage when asked

The operator wants to see which Plugin uses the most of the machine. So the Host reads each Plugin Server's Usage, and FirstMate's own, when the App or a terminal asks for it, and keeps none of it. It reads what the system already counts: `/proc` on Linux and in a `wsl` Place, and `Get-CimInstance Win32_Process` on Windows. It takes no dependency to do it. The Process View asks every two seconds while it is shown, and `firstmate usage` asks once.

## Rules

- Usage is read when asked and never kept. The Host holds the last reading of each process in memory, only to count CPU against the time between two readings, and drops it when the process ends. It writes nothing, and keeps no history of a Plugin (ADR-0005).
- The Host has no timer of its own for it (ADR-0004). The Process View asks while it is shown and the window is visible, and stops asking otherwise. With no earlier reading young enough, the Host reads twice, half a second apart, so a single ask still gets a CPU figure.
- Only the App and a terminal may read Usage, as only a terminal may ask for a restart. A request with an Origin or a Sec-Fetch-Site is refused. Every Plugin Page shares the Host's origin, and no Plugin needs the PIDs and memory of the others.
- Every Plugin Server starts with `FIRSTMATE_PLUGIN` set to its Plugin's name, and every process under it inherits it. On Linux and in a `wsl` Place, the Host finds a Plugin's processes by it, so a child that left its parent is still counted, and a `wsl` Plugin is found inside its distribution although Windows sees only `wsl.exe`. Windows lets no process read another's environment, so there the Host walks the tree from the process it started, and checks each start time so that a reused PID is not counted.
- FirstMate's row counts FirstMate's own processes, and no tree under them: everything under the Host is a Plugin Server, which has a row of its own. A Host with no App counts its own process. The App gives the Host the PIDs of its main process, its GPU process, Electron's helpers and the renderers of its own views and the Index Page, through a start hook, so the Host takes no Electron import. A Plugin Page's renderer is the Plugin's cost, and FirstMate's row never counts it.
- On Windows, one PowerShell stays open while the Process View is shown, and the Host asks it again on each refresh, because starting one takes most of a second. It ends a few seconds after the last ask, so when the view closes or the window hides, and when the Host stops. That end is the only timer, and it reads nothing. ADR-0020 had the App need no PowerShell helper; this one serves a reading only, and nothing else waits on it.
- The Host asks `wsl.exe` only for a distribution that holds a running Plugin, so a reading never starts a distribution.
- A reading that fails says why in its own row, and the other rows still show.

## Considered Options

pm2. It runs every process under its own daemon, so the Host would no longer hold the stdin and stdout of a Plugin Server, and MCP over stdio needs them, which is why ADR-0020 refused `utilityProcess` too. It restarts a process that exits, and a Stopped Plugin stays Stopped until the operator restarts it. And it is a runtime dependency, which the Host takes none of.

A history of Usage, to draw a chart or send a Notice when a Plugin uses too much. It is a record the Host would keep for a Plugin, which ADR-0005 forbids, and a Notice would need a timer in the Host, which ADR-0004 forbids.

Finding a `wsl` Plugin by its directory and its `./mcp` command. It needs no variable, but a shell the operator opened in that directory matches too.

## Consequences

A Plugin Server can read `FIRSTMATE_PLUGIN` to learn its own Plugin's name. It is part of what a Plugin can see, so the Plugin guide says so.

A `wsl` Plugin's CPU is counted inside its distribution's virtual machine, and its memory leaves out the machine itself. The Process View names the Place when more than one Place holds Plugins, so that the difference is visible.
