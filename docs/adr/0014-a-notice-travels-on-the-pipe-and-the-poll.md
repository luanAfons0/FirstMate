# A Notice travels on the pipe and the poll

A Plugin wants to tell the operator something while its page is closed, and
only the Tray can show a Windows pop-up. A Plugin Server sends a Notice to the
Host with `firstmate/notice` on the pipe the Host owns, so the sender's Plugin
Name comes from the connection and cannot be forged (ADR-0009). The Host holds
the last few Notices in memory for a short time, and the Tray reads them on the
poll it already runs. The Host itself sends a Notice the same way when a Plugin
goes Stopped.

## Considered Options

A Notice from a Plugin Page, through a new HTTP address. Rejected: it gives a
Plugin Page a way to reach the Host, and ADR-0009 keeps every Plugin Page off
it. A Plugin Page that wants a Notice calls a tool on its own Plugin Server.

A push stream from the Host to the Tray. Rejected: it is a second kind of
connection the Tray must keep open and reopen, to save at most one poll of
delay.

A Tray that shows the Notices it missed while it was not running. Rejected: it
shows old news in a burst, and it asks the Host to keep a history (ADR-0005).

## Consequences

The Host promises nothing about delivery. It answers "accepted" at once, and a
Notice no Tray reads in time is gone.

The title always starts with the sender's name, `<Plugin Name>: <title>`, so a
Plugin cannot speak as FirstMate or as another Plugin. A click opens an address
under the sender's own `/p/<name>/`, or the Index Page for the Host's own.

A Notice that is too long, or sent too soon after the last one from the same
Plugin, is refused with a sentence to the Plugin Server. The Host never cuts it
short or drops it in silence.

On Windows the Tray shows a Notice through a PowerShell helper of its own, not
through the webview library's `Notification`. The library sends every pop-up
under PowerShell's Application User Model ID and ignores the icon, so its
pop-ups say "Windows PowerShell". The helper sends them under FirstMate's own
ID, the one the taskbar button carries, and writes the one registry key that
names that ID to Windows. The webview class stays as the fallback when the
helper is not there.

A Tray that starts takes the latest sequence number and shows nothing. A Tray
that sees a new run of the Host, by a new token, asks for every Notice of that
run: the queue of a new run holds nothing old, and taking its latest number
would lose the Notices sent before the Tray noticed the restart.

A Plugin sets the title, the body and the click path, and nothing else.
Buttons would need a way back from the Tray to the Plugin Server, and that is a
larger design.

## Amended: the App hears each Notice in-process (2.0)

FirstMate 2.0 is an App that holds the Host in its own main process (ADR-0020), so the Tray no longer needs the poll. `start()` takes an `onNotice` hook, and the queue calls it with each Notice it takes. The App shows the Notice at once as a Windows notification through Electron's `Notification`, under its own Application User Model ID, which is the `appId` the installer gives its Start menu entry. So a Notice says FirstMate and wears the mark, and no PowerShell helper is needed. A click opens the Notice's address in the window, as before. Windows names an app's notifications from its Start menu entry, so the installed App's Notices say FirstMate; an App that was never installed has no entry, and Windows files its Notices under Electron.

Two consequences above no longer apply to the App: the poll's delay, and the rule about the latest sequence number a Tray takes when it starts. The App starts the Host, so it hears every Notice of the run from the first, and a Notice the Host takes while the App is still starting waits until the App can show it.

`/notices.json` stays as it is. It is read-only, it is how the tests watch the queue, and removing it would make nothing safer, because the queue holds only what a Plugin Server or the Host already said. The Host still promises nothing about delivery.

