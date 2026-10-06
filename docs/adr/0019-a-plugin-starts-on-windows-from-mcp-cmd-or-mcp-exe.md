# A Plugin starts on Windows from mcp.cmd or mcp.exe

FirstMate 2.0 runs the Host on Windows, and on Linux a Plugin Server is an executable file named `mcp` whose shebang picks the language (ADR-0001). Windows reads no shebang and keeps no executable bit, so the Host there looks for a form Windows itself knows how to run: `mcp.exe`, and then `mcp.cmd`, in the Plugin directory. A Plugin can ship both the shell form and a Windows form side by side, so one directory runs in either place. This changes the Plugin contract, and the 2.0 spec approved it.

Every Plugin Server, on every platform, receives `FIRSTMATE_NODE`: the Node that runs the Host. A Node Plugin's `mcp.cmd` is then one line, `@"%FIRSTMATE_NODE%" "%~dp0mcp" %*`, and the operator's machine needs no Node of its own. Inside the App, that Node is the App's own executable run as Node.

## How a .cmd file starts

Node refuses to start a `.cmd` file without a shell, since the fix for CVE-2024-27980, because cmd.exe reads a command line by rules of its own. The Host gives cmd.exe nothing to quote: the Plugin Server runs in its own Plugin directory, so the command is `.\mcp.cmd`, which holds no space and no character cmd.exe treats as special, wherever the Plugin lives. The file names its own directory as `%~dp0`, and quotes it.

## How a Plugin Server ends

Closing stdin is how MCP over stdio asks a server to end. On Linux the Host then sends `SIGTERM`, and `SIGKILL` five seconds later. Windows has no signal that asks: a kill there is at once. So on Windows the Host closes stdin, gives the same five seconds, and then kills the whole process tree, because a Plugin Server started from `mcp.cmd` is cmd.exe with the real program under it, and killing cmd.exe alone would leave the program running.

## Considered Options

Read the shebang on Windows and start the interpreter it names. `#!/usr/bin/env node` names a path Windows does not have, and a shebang for every interpreter would need a table the Host has to keep.

Start `mcp.cmd` with Node's `shell: true` and its full path in quotes. cmd.exe still expands `%` inside quotes, so a Plugin directory with a `%` in its name would break, and a test would have to prove each character.

## Consequences

A Plugin with only the shell form is Stopped on Windows, with one sentence that names the file it needs. A Plugin with none of the three files ships no Plugin Server, as before.

The `.cmd` form runs from a drive path only: cmd.exe cannot work in a `\\server\share` directory. A Plugin on such a path ships `mcp.exe` instead.

The home folder on Windows is `%APPDATA%\FirstMate`. Linux keeps `~/.firstmate`, because that is where a 1.x Host left its files. This is the first place the Host's source asks which platform it runs on.

CI runs the whole suite on `windows-latest` and on `ubuntu-latest`, and every fixture with a Plugin Server carries `mcp.cmd` beside `mcp`. The `unrunnable` fixture carries none, because on Windows it is the Plugin with only the shell form.
