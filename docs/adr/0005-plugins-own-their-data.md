# Plugins own their data

A Plugin owns every byte of its own state, and the Host stores only a Registry: which Plugins exist, where their directories are, and what Grants they hold. The Host never reads or writes a Plugin's data, and it keeps no run history, no logs and no settings store of its own.

## Consequences

There can be no page that shows data from several Plugins at once. The day that becomes desirable, it will be a change against this decision rather than an addition to it.

Plugin Server output is not collected by the Host. The Host runs under systemd, so the journal takes it.
