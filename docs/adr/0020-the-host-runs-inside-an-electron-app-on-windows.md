# The Host runs inside an Electron App on Windows

This supersedes ADR-0007 and ADR-0011. FirstMate 1.x was two halves: a Host under systemd in WSL Debian, and a Tray on Windows that found it through a file read over `\\wsl.localhost\`. Only its maintainer could install that, and every bug in the Tray lived in the seam between the halves. FirstMate 2.0 is one program a person installs on Windows: the App. Its main process starts the Host, and the App owns the window, and later the Tray, Notices, Shortcuts and start at logon. A Plugin in WSL is reached through a Place, not by putting the Host there.

The App is Electron 44, built by `electron-vite` and packaged by `electron-builder` as an NSIS installer, one click and per user, so it needs no administrator. It lives in `apps/desktop`. The 2.0 spec approved these dependencies.

## How the App holds the Host

The Host is a function, `start()` in `packages/host/src/start.ts`, which returns the port, the token and `stop()`. `node packages/host/src/main.ts` calls it and stops it on a signal, as before. The App calls it in its main process and stops it on Quit, so Quit ends every Plugin Server. The home, the port, the runtime file and every address are the same in both, so the command line and the tests reach the App's Host as they reach any other.

The App's window shows the Index Page at `http://127.0.0.1:<port>/?token=…`, admitted by the token as a browser is. The App never prints the token. A link away from the Host opens in the operator's browser. The Host still serves the window nothing of its own, and still frames nothing (ADR-0008).

## The window's views

Each Plugin Page the operator opens gets a `WebContentsView` of its own, with the sandbox on and no preload, and it stays loaded until the App quits. A Plugin Page that records a call keeps recording while the operator looks at another Plugin. The views share one browser session, so the token is traded for the cookie once, on the first load, and no later address carries it.

A view belongs to one owner: a Plugin, for everything under `/p/<name>/`, or the Index Page. A link to another owner's address is refused in the view it was clicked in, and that owner's view is shown instead, as it is. So one Plugin's page never shows in another Plugin's view, and never reloads it.

The strip, the switcher and the Settings View are the App's own views. Their pages are written by the App and loaded as data addresses, never served by the Host, for the reason ADR-0008 gives. They ask the main process for things through a preload that only they carry, and the main process also checks which view sent each message. In 1.x the strip asked by trying to navigate, because the webview library's message channel took the program down; Electron's IPC has no such fault, and a preload no Plugin Page carries is the narrower door.

## The Tray

The Tray is the App's notification-area icon. Closing the window only hides it, so the Tray is what holds the App, and Quit in its menu is the one way the App ends. The icon wears the stopped mark while any Plugin is Stopped.

The 1.x Tray polled the Host every few seconds to learn that. The App holds the Host, so `start()` takes hooks instead: `onChange` is called after a reload, after a restart, and with every Notice, because a Notice is how the Host says that a Plugin went Stopped. The App then asks `/plugins.json` over loopback, as a browser would, so the Host keeps one surface.

Start at logon is Windows's own entry for the App, written through Electron and off until the operator turns it on. The App it starts begins in the Tray with the window put away, because nobody asked to see it.

One App runs for one home. A second start shows the first window and ends, so there is never a second Host. Electron's own data, and with it the single-instance lock, lives in `app` under the home: a test that moves the home moves the lock, and never meets the App the operator runs. When the port is taken, the App says so in one sentence and does not start.

## How a Plugin Server runs

Every Plugin Server receives `FIRSTMATE_NODE`, the Node that runs the Host (ADR-0019). In the App that is the App's own executable, which runs as Node when `ELECTRON_RUN_AS_NODE` is set. The Host sets it for a Plugin Server, and never on the App's own process, because a relaunch or the installer would inherit it. Electron's `RunAsNode` fuse must stay on, so `electron-builder.yml` names it, on. A Plugin Server stays a child process: Electron's `utilityProcess` gives no stdin pipe, and MCP over stdio needs one.

## Considered Options

Keep 1.x: the Host in WSL, the window on Windows. It works for one machine set up by hand, and nobody else can install it.

Tauri, or the webview library of 1.x. Each draws a window, but the Host is TypeScript on Node (ADR-0006), so either would ship a Node beside it, and then a Plugin Server's Node, the Host's Node and the window are three programs to update. Electron is all three in one executable.

The Host as a separate process the App starts. It is one more process to supervise, and Quit would then have to reach across a pipe to stop the Plugin Servers.

## Consequences

ADR-0011 said FirstMate should not build a runtime of its own. That reason is given up: Electron is the runtime, and the App is about 110 MB to install. A Plugin still needs none of its own.

The App is built, and the build is not on the npm publish path. ADR-0017's rule bends here and holds everywhere else: a clone still runs the Host and the command line from source with no build, and only the App, which is Electron and cannot run from a clone's TypeScript, is built. Its build writes `apps/desktop/out/`, and packaging writes `apps/desktop/dist/`; a clone holds neither.

The App has one automated test. `tests/app.test.ts` packages the App, installer and all, starts the packaged program with a temporary home and port zero, and drives its Host through the same helper as every other test. It runs on Windows only. The window, as in ADR-0011, has no test.

The App ships unsigned for the betas, and Windows may warn before it runs. The certificate is decided before 2.0.0 final.

Electron fetches its binary the first time it runs, not when it is installed, so a clone that never starts the App never fetches it. Packaging fetches the Electron it packs on its own.
