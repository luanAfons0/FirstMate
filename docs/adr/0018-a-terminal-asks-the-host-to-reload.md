# A terminal asks the Host to reload

The Host used to read the Registry once, when it started. Every command that changed it ended with "restart the Host to pick it up", and a restart stops every Plugin Server, not only the one that changed. So the Host now reads the Registry and the settings again when it is asked, at `POST /reload`, and every command that writes them asks, over loopback, with the port and the token from the runtime file. A reload starts the Plugins that were added, stops the ones that were removed, hands the Tool Bus the new Grants, and leaves every other Plugin Server alone. It never starts a Stopped Plugin again: that would be the restart loop the Host refuses, with the operator's command for a trigger.

The address is the Host's own, not under `/p/<name>/`, so the Plugin contract does not change. It passes the same check as every request: the Host header, the Origin, Sec-Fetch-Site and the token.

## A page may never ask

The token does not make a request the operator's. ADR-0012 says why: every Plugin Page shares the Host's origin, so the browser attaches the cookie for it, and a header a page can shape proves nothing. So the reload address answers only a request that carries no `Origin` and no `Sec-Fetch-Site`. A browser sends an `Origin` on every POST, and no page can take it off; it sends `Sec-Fetch-Site` on every request. A terminal sends neither. A page that could reload would gain little, because a reload reads only what a terminal wrote, but the rule is the one every address that makes the Host act will follow, and it is pinned by a test.

## Considered Options

Watch the Registry and the settings, and reload on every change. A half-finished edit by hand would be read as the operator's intent, and a test would have to wait for a watcher instead of for an answer.

A signal, such as `SIGHUP`. The command line would need the Host's process id, which the runtime file does not hold, and a signal says nothing back: not that the Host read the files, and not why it could not.

A reload that restarts every Plugin Server, which is a restart with fewer steps. It interrupts every Plugin the operator did not touch, which is the whole of what was wrong.

## Consequences

The operator never restarts FirstMate by hand to pick up a command. `setup` stops asking whether to.

With no Host running, a command writes the files and says nothing more. A runtime file that a crashed Host left behind names a port nobody answers on, and the command line reads the refused connection as no Host at all.

A reload resolves once every added Plugin Server has answered its handshake or failed, so a command that ends has a Host that shows its change. Reloads run one at a time.

A Plugin removed is stopped on purpose, so its end sends no Notice. A Plugin whose directory changed is a removed Plugin and an added one, under the same name.

The Shortcuts and the Plugin Order were already read on every request (ADR-0013, ADR-0016). A reload does not change that: it is for what the Host holds, the Plugin Servers and the Grants, and the Shelf it shows.
