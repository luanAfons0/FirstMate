# Shortcuts are bound from a terminal and held by the Tray

A Plugin wants a key that works anywhere in Windows, and opens a small form
while the FirstMate window is hidden. A Plugin Server runs in WSL and cannot
see a Windows key, so the Tray holds every Shortcut. The operator binds one
with `bind <keys> <plugin> [path]`, and the Host remembers it in
`settings.json` beside the Shelf. So this narrows ADR-0012: the Host now keeps
two settings, and both are written from a terminal and from nowhere else, for
the reason that ADR gives. If a Plugin Page could set a Shortcut, every Plugin
Page could, because same-origin is not a trust boundary on this Host.

## Considered Options

A Shortcut set on the Plugin's own page. Rejected above: any Plugin could then
take a key in all of Windows.

A global keyboard hook, such as `uiohook-napi`. It sees every key the operator
presses, which puts a keylogger in FirstMate. `RegisterHotKey` gets only the
combinations that were bound.

An FFI library to call `RegisterHotKey`. It would be a second dependency, and
ADR-0011 names the window as the only one. A small PowerShell helper that owns
a message loop does the same, and the Tray already asks PowerShell for one
thing (`src/taskbar.ts`).

## Consequences

The Popup is a second window of the Tray's, not a frame: it loads a Plugin's
own address and shows the bytes the Host serves, so ADR-0008 stands. It hides
when it loses focus, on Esc, on its own Shortcut again, and when its page
navigates away from its own address. The Tray blocks that navigation and hides
the Popup, the same "refuse the navigation and act" method the chrome strip
uses. That is how a Plugin Page says "I am finished" with no channel into the
Tray.

A key that Windows refuses, because another program already holds it, is said
in a Windows notification. It is never dropped in silence.

The Tray picks up a new or changed Shortcut with no restart.

## Amended: the App holds the Shortcuts (2.0)

FirstMate 2.0 is an App (ADR-0020), and the App holds the Shortcuts, with Electron's `globalShortcut` in place of the PowerShell helper. That is still `RegisterHotKey` underneath, so the App gets the combinations that were bound and sees no other key. They are still bound from a terminal and nowhere else.

The App reads `/shortcuts.json` when it starts and again after every reload, so `bind` and `unbind` take effect at once. Core's normal form becomes Electron's key format by two names: `Ctrl` is `Control` and `Win` is `Super`; every other key is written the same in both. Electron answers false, with no error, for keys another program holds. The App says so in a Notice from FirstMate, once: it asks for those keys again only after they are unbound and bound again, so a taken key is not one more Notice on every reload.

The Popup is a window of the App's own with no frame, on top of every other window, with no taskbar button, no preload and the sandbox on. It hides as before, and Esc now hides it while it has the focus, rather than through a key held for all of Windows while it is shown.

