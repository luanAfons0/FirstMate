# The Host keeps one log

Under systemd, the Host's output and every Plugin Server's stderr went to the journal, and `journalctl` read it. The App has no journal, and a Windows program with no console has nowhere to write. So the Host keeps its own output in one file in its home directory, `firstmate.log`, and `firstmate logs` prints it; `logs -f` follows it. It does this wherever it runs, in the App or in a terminal, so there is one way to read it.

A Plugin Server's stderr is piped into the Host and written as the Host's own output, rather than inherited, because the App has no console to inherit. A terminal still shows everything it showed before.

## Rules

- The file never grows past its cap, two megabytes. When the next write would take it past, the file becomes `firstmate.log.old`, replacing the one before, and a new file begins. `logs` prints the older file first.
- The token never reaches the log. A person pastes a log into a bug report, and the runtime file is where the token lives.
- It is the Host's one log, not a record per Plugin. The Host keeps no run history and no log of what was called (ADR-0005): the log holds what the Host and the Plugin Servers chose to say, and nothing the Host records about a call.

## Considered Options

A file per Plugin. It would be a record the Host keeps for a Plugin, which ADR-0005 forbids, and the operator would have to know which file to read.

Leave it to the App. A Host started from a terminal would then keep no log, and `logs` would answer for one of the two only.

## Consequences

Every run writes `firstmate.log` beside the Registry and the runtime file. A test that lists the home directory sees it.
