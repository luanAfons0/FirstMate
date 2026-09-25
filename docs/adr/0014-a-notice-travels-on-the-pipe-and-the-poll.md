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
