# A terminal asks the Host to reload

The Host used to read the Registry once, when it started. Every command that changed it ended with "restart the Host to pick it up", and a restart stops every Plugin Server, not only the one that changed. So the Host now reads the Registry and the settings again when it is asked, at `POST /reload`, and every command that writes them asks, over loopback, with the port and the token from the runtime file. A reload starts the Plugins that were added, stops the ones that were removed, hands the Tool Bus the new Grants, and leaves every other Plugin Server alone. It never starts a Stopped Plugin again: that would be the restart loop the Host refuses, with the operator's command for a trigger.

The operator's own restart of one Plugin, `firstmate restart <name>`, is the same kind of request at `POST /restart/<name>`. It stops that Plugin Server, Stopped or not, waits for it to end, and starts it again. It is the one way a Stopped Plugin runs again, and only because the operator asked for it by name.

Both addresses are the Host's own, not under `/p/<name>/`, so the Plugin contract does not change. Both pass the same check as every request: the Host header, the Origin, Sec-Fetch-Site and the token.

## A page may never ask

The token does not make a request the operator's. ADR-0012 says why: every Plugin Page shares the Host's origin, so the browser attaches the cookie for it, and a header a page can shape proves nothing. So both addresses answer only a request that carries no `Origin` and no `Sec-Fetch-Site`. A browser sends an `Origin` on every POST, and no page can take it off; it sends `Sec-Fetch-Site` on every request. A terminal sends neither. A page that could reload would gain little, because a reload reads only what a terminal wrote. A page that could restart another Plugin would reach past its own Plugin, which ADR-0009 forbids, and could start a broken Plugin in a loop. The rule is the one every address that makes the Host act follows, and a test pins it for each.

## Considered Options

Watch the Registry and the settings, and reload on every change. A half-finished edit by hand would be read as the operator's intent, and a test would have to wait for a watcher instead of for an answer.

A signal, such as `SIGHUP`. The command line would need the Host's process id, which the runtime file does not hold, and a signal says nothing back: not that the Host read the files, and not why it could not.

A reload that restarts every Plugin Server, which is a restart with fewer steps. It interrupts every Plugin the operator did not touch, which is the whole of what was wrong.

## Consequences

The operator never restarts FirstMate by hand to pick up a command. `setup` stops asking whether to.

With no Host running, a command writes the files and says nothing more. A runtime file that a crashed Host left behind names a port nobody answers on, and the command line reads the refused connection as no Host at all.

A reload resolves once every added Plugin Server has answered its handshake or failed, so a command that ends has a Host that shows its change. Reloads run one at a time.

A Plugin removed is stopped on purpose, so its end sends no Notice. It has five seconds to end before the Host kills it, and nothing new starts until it has ended, so one Plugin never runs beside its old self. A Plugin whose directory changed is a removed Plugin and an added one, under the same name.

A command that runs while the Host starts finds no runtime file yet, so it asks nobody. The Host reads the Registry once more as it finishes starting, and reloads when the Registry changed under it.

The Shortcuts and the Plugin Order were already read on every request (ADR-0013, ADR-0016). A reload does not change that: it is for what the Host holds, the Plugin Servers and the Grants, and the Shelf it shows.
