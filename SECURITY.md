# Security policy

## Reporting a fault

Write to **luan.henrique.afonso04@gmail.com**. Please do not open a public
issue for a security fault.

Say what you did, what happened, and what you expected. A fixture Plugin or a
sequence of requests that shows the fault is worth more than a description of
it.

You will get an answer. FirstMate is one person's project, so expect days
rather than hours.

## What the Host promises

These are the promises worth testing. A way around any one of them is a
vulnerability.

- **Loopback only.** The Host binds `127.0.0.1` and no other address
  (ADR-0007). Nothing it serves is reachable from another machine.
- **A token on every request.** The token is minted fresh at every start and
  written to `runtime.json` inside the Host's home directory, readable by the
  owning user alone. It arrives on the first navigation as a query parameter,
  after which the Host sets a host-only `SameSite=Strict` cookie and redirects
  to the same address without it.
- **Host and Origin are checked.** Every request is checked against the address
  the Host listens on, because DNS rebinding against local services is
  exploited in the wild.
- **A Plugin Page never leaves its own directory.** The Host serves a Plugin's
  `web/` directory byte for byte and never a path outside it.
- **A Plugin Page reaches only its own Plugin.** `POST /p/<name>/rpc` carries a
  tool call to that Plugin's Plugin Server and to no other.
- **The Tool Bus carries a call only under a Grant.** A Plugin Server may call
  another Plugin's tools when, and only when, the Registry records a Grant for
  that pair, in that direction. The calling Plugin Name comes from the stdio
  pipe the Host spawned and owns, so it cannot be forged (ADR-0009).

## What is not a vulnerability

- **A Plugin doing what a Plugin may do.** A Plugin is a directory the owner
  registered, run with the owner's own privileges. The Host is a process
  supervisor, not a sandbox. It never inspects, restricts or sandboxes what a
  Plugin Server does with the machine, and it owns none of a Plugin's data
  (ADR-0005). Registering a hostile Plugin is the same act as running a hostile
  program.
- **A granted call between two Plugins.** A Plugin Server calling another
  Plugin's tools where the Registry records a Grant is the Tool Bus working.
  Report a call that crosses **without** a Grant, or one whose caller is
  misattributed.
- **Anyone holding the token.** The token admits its holder. It is a local
  single-user Host, so a person who can already read the owning user's files
  can read `runtime.json`, and that is the same person.
- **A Stopped Plugin staying Stopped.** The Host never restarts a Plugin
  Server that exited. A broken Plugin stays visible rather than spinning in a
  restart loop. This is deliberate.
- **Anything the Host prints.** The Host never prints the token to a journal,
  and a report that it does is a real fault. Output a Plugin Server writes is
  the Plugin's own.
