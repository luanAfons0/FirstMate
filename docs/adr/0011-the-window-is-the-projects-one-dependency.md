# The window is the project's one dependency

FirstMate has a window of its own, drawn by `@webviewjs/webview`, and that library is the first and only dependency this project has ever taken. Until now the Tray handed an address to the default browser, and a Plugin Page lived as a tab among thirty others with no way back to the Plugin list; a window FirstMate owns is the part that was missing, and nothing in plain Node can draw one. The window runs on Windows, where the desktop is, and reaches the Host over loopback, which WSL already forwards (ADR-0007).

The Host does not pay for it. The library is imported by `src/desktop.ts` alone, when the desktop subcommand runs and never when a module loads, so `start`, `add`, `remove`, `list`, `grant` and `revoke` all keep working on a machine where the native binary is missing or will not load for want of system libraries. `tests/desktop-command.test.ts` makes that machine on purpose and proves it.

## Considered Options

An optional dependency, which was the safer-looking shape. It is not: an install that quietly skips the library leaves a command that cannot say why it will not run, and the lazy import already gives the same protection with one failure mode instead of two.

Electron or Tauri, each of which brings a runtime of its own. FirstMate exists so that no tool has to build a runtime of its own, and it should not start by building one for itself.

## Consequences

Every install pulls the library's native binary for its platform, including a headless server install that will never open a window. This is accepted rather than avoided.

"No runtime dependencies" stops being true as written, and the contributor guide says the true thing instead: the Host imports nothing outside Node, and the desktop program has one dependency. The day the library becomes a burden, the desktop program can leave the package without the Host moving at all, because the Host imports nothing from it.

The program is written in two parts. `src/desktop-state.ts` decides: it takes the runtime file and the Host's answers and produces a state, and it imports nothing native and owns no window. `src/desktop.ts` shows: it owns the window and the library. The desktop program ships without automated tests, as the PowerShell Tray does today, and the split is what would make the deciding part testable if that choice is ever revisited. It is worth revisiting: both bugs ever filed against the Tray lived in the deciding part.

The window's browser engine keeps its data in `%LOCALAPPDATA%\FirstMate\Window`. Told nothing, it writes beside the program hosting it, which is `node.exe` inside Program Files, and the window then does not open at all.

ADR-0008 stands: the Host still frames nothing. The chrome strip above the content view is the program's own view, and the Host does not serve it. That is the whole of what makes it safe, because every Plugin Page shares an origin with the Index Page and could rewrite a strip the Host had served.
