# The App runs on Windows and Linux

This amends ADR-0020, which said the App is for Windows. An operator on a Linux desktop could not install the App, because the Tray, start at logon, the marks, the installer and `firstmate desktop` all assumed Windows. The App now runs on Windows and on Linux, as one program with one source. macOS is out for now: its marks, menu, Dock, permissions, signing and installers are not in scope. The spec is issue #167, decision B1.

## What changes

- **One program.** `apps/desktop` stays one Electron program. A thing that exists on one system alone runs on that system alone: the window's app details and the App User Model ID on `win32`, and loopback system audio on Windows.
- **Packages.** Windows keeps the NSIS installer. Linux gets an AppImage and a deb, in the category Utility. The `RunAsNode` fuse stays on (ADR-0020). electron-updater updates the AppImage. The package manager updates the deb, so the App does not. The deb ships an AppArmor profile, so the Chromium sandbox runs on Ubuntu 24.04.
- **The packaged-App test runs on both.** `tests/app.test.ts` packages the App on Windows and on Linux, starts it with its own home and port, and drives its Host. The window still has no test.
- **Start at logon.** It is still one entry that starts the App with `--at-logon`, and the App and `setup` write the same one through `core`. On Windows it is the Run value `FirstMate`. On Linux it is an XDG autostart desktop entry in the user's config directory.
- **The Tray.** On Linux it is an AppIndicator. GNOME shows none without its extension, so a second start of the App shows the window.
- **Shortcuts.** Under Wayland the App turns on Electron's `GlobalShortcutsPortal` feature before it is ready. X11 needs nothing. `Win` still means `Super`.
- **Places.** The `wsl` kind exists on Windows only. `core` refuses it on another system with one sentence, and the Settings View does not offer it there.
- **The window.** Its strip is the title bar on both systems, and the window's own buttons stay where the system puts them.
- **`firstmate desktop`.** On Linux outside WSL it installs the AppImage of its own version, as it installs the Windows installer. Inside WSL it still installs the Windows App.

## Amended

This ADR amends five others, and each carries one line that points here:

- ADR-0013 says "all of Windows" for a Shortcut.
- ADR-0016 says the Settings View moves the Plugin Order through `wsl.exe`. The App is one program, so its main process calls `core`'s move itself.
- ADR-0020 says the App is for Windows, and packs one NSIS installer.
- ADR-0023 names the installer files.
- ADR-0024 writes start at logon as a Windows value only.

## Considered Options

Windows only, as ADR-0020 had it. It leaves every Linux operator without the App, although the Host and the command line already run there.

Windows, Linux and macOS. macOS needs signing, notarization, its own menu and its own marks, and nobody on the project can test it.

An AppImage alone on Linux. Debian and Ubuntu operators expect a deb, so both ship.

## Consequences

CI runs `pnpm check` on Linux and Windows, and the packaged-App test on both.

The README and `CONTEXT.md` say Windows only where it is true.

ADR-0023's file table has no Linux rows yet. The release ticket (#177) adds them before any command line that reads them is published, because those names are a contract.

The betas stay unsigned.
