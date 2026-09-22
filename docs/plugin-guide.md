# How to write a Plugin

A Plugin is a directory. Put a `web/` directory in it and the Host serves
that as a Plugin Page. Put an executable named `mcp` in it and the Host
starts that as a Plugin Server. A directory with neither is still a Plugin;
it just has nothing to show.

That is the whole of it. There is no manifest, no schema and no file in
which a Plugin declares itself, and there is not going to be one
([ADR-0002](adr/0002-a-plugin-is-a-convention-not-a-manifest.md)).

## Two halves, kept apart

This guide has two halves, and the split is the point of it.

**What the Host enforces** is behaviour you can observe. Get it wrong and
the Host tells you: a status code, a state on the Index Page, a line in the
journal. Every statement in that half is checked by a test.

**What the project advises** is taste. It is what worked for the first
Plugin. Disagree with any of it and nothing breaks.

A guide that presents its taste as law is a manifest written in prose, and
a manifest is what ADR-0002 refused. So the two are never mixed. If a
sentence is in the first half, the Host will stop you. If it is in the
second, only your own judgement will.

---

# What the Host enforces

## The directory and the name

The Registry holds an absolute path. Adding a Plugin neither copies the
directory nor symlinks it, so a Plugin stays in its own repository wherever
it already lives:

```sh
node src/cli.ts add <name> /absolute/path/to/your/plugin
```

A Plugin you do not have on disk yet is fetched and registered in one step. A
directory is copied and a git URL is cloned; either way the files land in the
Shelf, and nothing your Plugin ships is run:

```sh
node src/cli.ts install /absolute/path/to/a/plugin [name]
node src/cli.ts install https://example.com/someone/a-plugin.git [name]
```

A Plugin Name is lower-case letters and digits, with single hyphens between
them: `nexus`, `spy`, `scheduled-job`. No leading hyphen, no trailing one,
no two in a row. The rule is strict because the name is not a label — it is
the address. Your Plugin lives at `/p/<name>/`, and every link, every
relative path and every tool call resolves from there.

The Host refuses a name that does not fit, a path that is not absolute, a
path that is not a directory, and a name already in the Registry. It says
which, in a sentence you can act on.

The Registry is read once, when the Host starts. After `add`, `install` or
`remove`, restart the Host — from the Tray, or with
`systemctl --user restart firstmate`.

## The Plugin Page: your `web/` directory

Optional. If `web/` is there, everything in it is served at `/p/<name>/`.

- **The bytes are yours.** The Host returns them unchanged. It does not
  rewrite them, wrap them, inject into them or frame them
  ([ADR-0008](adr/0008-a-plugin-page-is-a-whole-page.md)). Every relative
  path you already wrote keeps working, because nothing moved.
- **A directory is served as its `index.html`.** A request for a directory
  without a trailing slash is answered `308` to the same address with one.
  Without that redirect every relative path inside your page would resolve
  one directory too high.
- **Nothing outside `web/` is reachable.** A path that escapes it is `403`,
  whether it is spelled `..`, `%2e%2e` or with a NUL in it. Keep private
  files in the Plugin directory beside `web/` and no browser will ever see
  them.
- **Content types come from the extension**, from a fixed table: `.html`,
  `.css`, `.js`, `.mjs`, `.json`, `.map`, `.svg`, `.png`, `.jpg`, `.jpeg`,
  `.gif`, `.webp`, `.ico`, `.txt`, `.wasm`, `.woff`, `.woff2`. Anything
  else is `application/octet-stream`.
- **A missing file is `404`**, and so is a request to a Plugin with no
  `web/` at all.
- **Everything here is read-only.** `GET` and `HEAD`. Any other method is
  `405` with an `Allow` header.

## The Plugin Server: your `mcp` executable

Optional. If `mcp` is there, the Host starts it and holds the connection
for the life of the Host.

- **It must be a file, and it must carry the executable bit.** An `mcp`
  that cannot be run leaves your Plugin **Stopped**, with one line in the
  journal and no other symptom. This is the mistake that costs an
  afternoon. Run `chmod +x mcp`.
- **The shebang chooses the language.** The Host runs the file; it does not
  care what is in it. Python, Node, a shell script, a compiled binary.
- **It is started in your Plugin's directory.** Your working directory is
  the Plugin directory, not `web/` and not the Host's. You can open your
  own files by a relative path.
- **stdin and stdout carry MCP, and nothing else.** One JSON-RPC message
  per line. A line on stdout that is not JSON is reported in the journal
  and dropped, so a stray `print` breaks the transport. Send your
  diagnostics to **stderr**, which goes straight to the Host's own output —
  under systemd, the journal. Read it with
  `journalctl --user -u firstmate -f`.
- **It must answer the handshake.** The Host sends `initialize` with
  `protocolVersion` `2025-06-18` and waits `FIRSTMATE_HANDSHAKE_MS`
  milliseconds, ten seconds by default. Answer it and the Host sends
  `notifications/initialized` and your Plugin is Running. Stay silent and
  your Plugin is **Stopped** — a Plugin Server the Host cannot talk to is
  no use to a Plugin Page.
- **Closing stdin is how you are asked to stop.** The Host closes it and
  then sends `SIGTERM`.

## Calling your own tools

A Plugin Page calls its own tools with one ordinary request. There is no
bridge API to learn
([ADR-0003](adr/0003-plugin-pages-reach-their-tools-over-same-origin-http.md)):

```js
const answer = await fetch('rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
```

One address, `POST /p/<name>/rpc`, and the body is an MCP JSON-RPC request.
The Host forwards it to your Plugin Server and returns the answer.

- **Your JSON-RPC id comes back as you sent it.** The Host renumbers
  requests on the way out so that two callers never see each other, and
  gives you your own id back. A number or a string both work.
- **Only your own Plugin Page may call your tools.** Every Plugin Page is
  same-origin with every other, so the Host reads the `Referer` to tell
  which page is calling. Another Plugin's page gets `403`. A terminal sends
  no `Referer` and is answered, because exercising the address with `curl`
  is the point of it.
- **What the Host answers when it cannot forward:** `404` for an unknown
  Plugin, `405` for anything that is not a `POST`, `400` with JSON-RPC
  error `-32700` for a body that is not JSON, `501` for a Plugin that ships
  no Plugin Server, `503` for a Plugin that is Stopped.

## Calling another Plugin's tools

Your Plugin Server can call the tools of another Plugin, over the same
pipe it already speaks MCP on. Write one JSON-RPC request on your stdout
and read the answer on your stdin
([ADR-0009](adr/0009-the-tool-bus-runs-over-the-pipe-the-host-owns.md)):

```json
{"jsonrpc":"2.0","id":1,"method":"firstmate/tools/call",
 "params":{"plugin":"other","name":"its-tool","arguments":{}}}
```

`firstmate/tools/list` takes `{"plugin":"other"}` and lists that Plugin's
tools. Both hand you the other Plugin's own answer, unchanged.

- **The Host carries it only under a Grant.** The operator records one with
  `firstmate grant <you> <other>`. A Grant is one way and covers one pair,
  and there is no exception: to call yourself, you are granted yourself.
- **You are never asked who you are.** The Host spawned your process and
  owns your pipe, so it already knows. You hold no token and no port, and
  there is nothing for you to leak.
- **Your own request numbers stay yours.** The Host answers with the id you
  gave and never one of its own, so number your requests however you like.
- **The handshake tells you it is there.** The `initialize` the Host sends
  you carries `capabilities.experimental.firstmate.toolBus`.
- **Every refusal is a sentence**, as a JSON-RPC error: you hold no Grant
  for that Plugin, no Plugin is registered under that name, it is Stopped,
  it ships no Plugin Server, or the chain has passed through too many
  Plugins.
- **A Plugin Page cannot do this.** The Tool Bus is on the pipe, and a
  browser holds no end of it. Your page reaches your Plugin and no other.

## The token, which your page never handles

The Host mints a token when it starts and refuses every request that does
not carry it. Your page carries nothing.

The token arrives once, as a query parameter on the first navigation. The
Host sets a host-only `SameSite=Strict` cookie and redirects to the same
address without the parameter, so your relative paths are never disturbed.
Every request after that carries the cookie.

Never write the token into your markup, your JavaScript or a file of your
own. You will not need it, and it is minted fresh at every start, so a copy
is worthless by tomorrow.

The Host also checks the `Host` header, the `Origin` and `Sec-Fetch-Site`
on every request, including tool calls. From inside your own page all three
are already right. If you are testing from somewhere else and getting
`403`, that is why.

## The three states

The Index Page and the Tray show one word about each Plugin. There are
three, and each has an exact cause:

| State              | What it means                                       |
| ------------------ | --------------------------------------------------- |
| `Running`          | Your `mcp` started and answered the handshake.      |
| `Stopped`          | It could not be run, exited, or would not answer.   |
| `no Plugin Server` | There is no `mcp` file. This is allowed.            |

`no Plugin Server` is not a failure. A Plugin that is only a page is a
Plugin.

Two things follow, and both are deliberate:

- **A Stopped Plugin still serves its Plugin Page.** You can open your page
  and debug a broken Plugin Server from it.
- **The Host will never start it again.** A broken Plugin stays visible
  rather than spinning in a restart loop behind the operator's back. Fix it
  and restart the Host.

One Stopped Plugin leaves every other Plugin serving.

---

# What the project advises

None of this is enforced. All of it is what the first Plugin learned.

- **Write relative paths and nothing else.** The Host rewrites nothing, so
  relative paths are the ones that survive. Anything absolute assumes an
  address you do not own.
- **Vendor your assets.** There is no build step, no bundler and no
  watcher, and there is not going to be one. Put the file in `web/` and
  link to it.
- **One tool-call address, not an endpoint per action.** Nexus began with a
  REST call per endpoint and replaced them all with `rpc` and an MCP
  request in the body. Your tools are already the list of things your
  Plugin can do; a second vocabulary beside them earns nothing.
- **Own your data.** The Host keeps no history, no logs and no settings for
  you, and never reads or writes a Plugin's data
  ([ADR-0005](adr/0005-plugins-own-their-data.md)). Decide where your state
  lives on the first day.
- **Expect no scheduler.** The Host runs nothing on a timer
  ([ADR-0004](adr/0004-the-host-owns-no-scheduler.md)). If your Plugin
  needs one, it brings its own.
- **Do not read the Host's runtime file, and do not print the token.**
  Nothing in `$FIRSTMATE_HOME` is yours.
- **Say nothing when nothing is wrong.** Your stderr is the operator's
  journal, shared with the Host and every other Plugin. Earn each line.

## Before you register it

- [ ] The directory is at an absolute path you are happy to leave it at.
- [ ] The name is lower-case letters, digits and single hyphens.
- [ ] `chmod +x mcp` — check this first when the Plugin is Stopped.
- [ ] `./mcp` runs from the Plugin directory without an import error.
- [ ] It answers `initialize` within ten seconds.
- [ ] Nothing but JSON-RPC goes to stdout. Diagnostics go to stderr.
- [ ] `web/index.html` exists, if you ship a page.
- [ ] Every path in the page is relative.
- [ ] No token, anywhere, in anything you wrote.

Then:

```sh
node src/cli.ts add <name> /absolute/path/to/your/plugin
systemctl --user restart firstmate
```

Open the Index Page. If it says `Stopped`, the reason is in
`journalctl --user -u firstmate -f`.

## Two worked examples

**The smallest one that is complete.** `tests/fixtures/both/` is a whole
Plugin in about sixty lines: an `mcp` in Python that answers `initialize`,
`tools/list` and `tools/call`, and a `web/` directory beside it. It is
Python precisely to show that the Host does not care what a Plugin Server
is written in. `tests/fixtures/server-only/` is the same in JavaScript,
with no page at all.

**A real one.** Nexus is FirstMate's first Plugin.
[`nexus-migration.md`](nexus-migration.md) records what it once had to
build for itself — a loopback listener, a static allowlist, a run token, a
tray — and what it deleted when the Host gave it all four. That document is
the argument for this one.
