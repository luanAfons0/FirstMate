# The npm package is the command line only

In 1.x the npm package was FirstMate: it carried the Host, the window and the systemd service, and `firstmate start` ran the Host from it. In 2.0 the App holds the Host and the window (ADR-0020), so the package keeps one job: the command line. It is one bundled file with no runtime dependency. It carries no Host, no window, no PowerShell helper, no logon script and no systemd unit, and `start` and `service` are gone with them. `@webviewjs/webview`, the 1.x window's one dependency, is gone too.

Every writing command still writes the files through `core`, so it works when the App is closed, and asks the running Host to reload when one runs (ADR-0018). `firstmate desktop` installs the App of the package's own version (ADR-0023). `setup` asks, in order: the Shelf and the Places, the import of a 1.x install, the Official Plugins with a Place for each, Grants, Shortcuts, and start at logon.

## Rules

- `apps/cli` imports nothing from `packages/host`. The words both say about a Plugin's state, and the token's query parameter, live in `core`. A test proves that the packed bundle holds none of the Host's own code.
- A command that needs the running Host, such as `status` and `restart`, says to run `firstmate desktop` when there is a Windows here and no App on it, and says only that no Host runs anywhere else.
- Start at logon is one value, `FirstMate`, in the Windows Run key, which starts the App with `--at-logon`. The App's Tray and `setup` write the same value, so each sees what the other set. `setup` asks only where the App is installed, and it is off until the operator says yes.
- The Official Plugins data says which kinds of Place each one runs in, and `setup` offers only those Places. That is a fact FirstMate knows about its own Plugins, written in its own data, and not a manifest a Plugin carries (ADR-0002, ADR-0015). Each Plugin moves to the `windows` Place in a release of its own, and a 2.x minor changes its line.

## Considered Options

Keep the Host in the package, so that `npx … start` still runs a Host with no App. Two Hosts would then be on offer, with two ways to keep one running, and the one the spec builds for is the App. A clone still runs the Host on plain Node, which is all a contributor needs.

Have `setup` turn start at logon on through the App. The App may not be running when `setup` runs, and a terminal command that needs the App open to answer one question is a surprise.

## Consequences

`firstmate start`, `firstmate service` and `journalctl` are gone; `firstmate logs` reads the Host's log instead (ADR-0022). A 1.x operator moves with `firstmate import` (ADR-0021), which also offers to turn the 1.x service off. The 2.0.0 release notes say so.

ADR-0011's one dependency, the window library, no longer exists, and that ADR is superseded by ADR-0020 already.

Note: the bundle now carries `@clack/prompts`, a devDependency, for the questions `setup` asks on a terminal. The package still depends on nothing (ADR-0025).

## Amended: start at logon on each system (ADR-0026)

ADR-0026 amends this ADR: start at logon is one entry on each system, the Run value on Windows and an XDG autostart entry on Linux, and the App and `setup` write the same one.
