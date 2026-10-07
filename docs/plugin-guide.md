# How to write a Plugin

A Plugin is a directory. Put a `web/` directory in it and the Host serves
that as a Plugin Page. Put an `mcp.ts` in it, or an executable named `mcp`,
and the Host starts that as a Plugin Server. A directory with neither is still a Plugin;
it just has nothing to show.

That is the whole of it. There is no manifest, no schema and no file in
which a Plugin declares itself, and there is not going to be one
([ADR-0002](adr/0002-a-plugin-is-a-convention-not-a-manifest.md)).

## Two halves, kept apart

This guide has two halves, and the split is the point of it.

**What the Host enforces** is behaviour you can observe. Get it wrong and
the Host tells you: a status code, a state on the Index Page, a line in the
log. Every statement in that half is checked by a test.

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
firstmate add <name> /absolute/path/to/your/plugin
```

A Plugin you do not have on disk yet is fetched and registered in one step. A
directory is copied and a git URL is cloned; either way the files land in the
Shelf, and nothing your Plugin ships is run:

```sh
firstmate install /absolute/path/to/a/plugin [name]
firstmate install https://example.com/someone/a-plugin.git [name]
```

In a clone of FirstMate, `node apps/cli/src/cli.ts` takes the place of
`firstmate` in every command here.

A Plugin Name is lower-case letters and digits, with single hyphens between
them: `nexus`, `scheduler`, `scheduled-job`. No leading hyphen, no trailing one,
no two in a row. The rule is strict because the name is not a label — it is
the address. Your Plugin lives at `/p/<name>/`, and every link, every
relative path and every tool call resolves from there.

The Host refuses a name that does not fit, a path that is not absolute, a
path that is not a directory, and a name already in the Registry. It says
which, in a sentence you can act on.

Each of `add`, `install` and `remove` asks the running Host to reload, so the
Host picks the change up with no restart (ADR-0018). In a `wsl` Place, keep
your `mcp` file as it is. On Windows itself, a Node Plugin ships `mcp.ts`, and
a Plugin in another language ships `mcp.exe` or `mcp.cmd` beside `mcp`
(ADR-0019, ADR-0028).

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

## The Plugin Server: your `mcp.ts`, or your `mcp` executable

Optional. If a Plugin Server file is there, the Host starts it and holds
the connection for the life of the Host.

- **Ship one `mcp.ts`, and it runs everywhere the App does.** The Host
  looks for `mcp.ts`, then `mcp.js`, then the forms below: `mcp` on Linux,
  and `mcp.exe`, then `mcp.cmd`, on Windows. It starts the first it finds
  ([ADR-0028](adr/0028-a-plugin-server-can-be-mcp-ts-run-by-the-hosts-node.md)).
  A Node file is started with the Host's own Node, `FIRSTMATE_NODE`, with
  the file's name as its one argument, and no shell: `<FIRSTMATE_NODE>
  mcp.ts`. That Node strips TypeScript's types, so `mcp.ts` needs no build,
  no executable bit, no `mcp.cmd`, and no Node on the operator's machine.
  Start it the same way in your own tests: `process.execPath` with
  `mcp.ts`, in the Plugin directory, with no shell.
- **A `wsl` Place starts `mcp` only.** There the Host runs `./mcp` inside the
  distribution, and its Node, a Windows program, does not cross over. A
  Plugin with `mcp.ts` and no `mcp` is **Stopped** there, with one sentence
  that says so. Keep `mcp` beside `mcp.ts` if your Plugin may live in a
  `wsl` Place; the Host takes `mcp.ts` everywhere else.
- **An `mcp` must be a file, and it must carry the executable bit.** An `mcp`
  that cannot be run leaves your Plugin **Stopped**, with one line in the
  log and no other symptom. This is the mistake that costs an
  afternoon. Run `chmod +x mcp`. On Windows there is no executable bit: the
  cause is a Plugin with `mcp` alone, and the log says so (see below):
  `mcp cannot run on Windows: it needs mcp.ts, mcp.cmd or mcp.exe`.
- **The shebang of `mcp` chooses the language.** The Host runs the file; it
  does not care what is in it. Python, Node, a shell script, a compiled binary.
- **On Windows, a Node Plugin ships `mcp.ts`, and any other ships `mcp.exe`
  or `mcp.cmd` beside `mcp`.** Windows reads no shebang and has no
  executable bit, so after `mcp.ts` and `mcp.js` the Host runs `mcp.exe`, or
  else `mcp.cmd`, and a Plugin with only `mcp` is **Stopped**
  ([ADR-0019](adr/0019-a-plugin-starts-on-windows-from-mcp-cmd-or-mcp-exe.md)).
  `mcp.cmd` is for a language Windows starts from a command line, such as
  Python: `@python "%~dp0mcp" %*`. A Node Plugin needs no `mcp.cmd`.
- **`FIRSTMATE_NODE` names a Node you may use.** Every Plugin Server
  receives it, on every platform: the Node that runs the Host. A Node
  Plugin needs no Node of its own.
- **It is started in your Plugin's directory.** Your working directory is
  the Plugin directory, not `web/` and not the Host's. You can open your
  own files by a relative path.
- **stdin and stdout carry MCP, and nothing else.** One JSON-RPC message
  per line. A line on stdout that is not JSON is reported in the log
  and dropped, so a stray `print` breaks the transport. Send your
  diagnostics to **stderr**, which the Host writes as its own output and
  keeps in its log. Read it with `firstmate logs -f`
  ([ADR-0022](adr/0022-the-host-keeps-one-log.md)).
- **It must answer the handshake.** The Host sends `initialize` with
  `protocolVersion` `2025-06-18` and waits `FIRSTMATE_HANDSHAKE_MS`
  milliseconds, ten seconds by default. Answer it and the Host sends
  `notifications/initialized` and your Plugin is Running. Stay silent and
  your Plugin is **Stopped** — a Plugin Server the Host cannot talk to is
  no use to a Plugin Page.
- **Closing stdin is how you are asked to stop.** The Host closes it and
  then sends `SIGTERM`. Windows has no such signal: there the Host closes
  stdin, waits five seconds, and then ends your whole process tree.

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
 "params":{"plugin":"scheduler","name":"its-tool","arguments":{}}}
```

`firstmate/tools/list` takes `{"plugin":"scheduler"}` and lists that
Plugin's tools. Both hand you the other Plugin's own answer, unchanged.

- **The Host carries it only under a Grant.** The operator records one with
  `firstmate grant <you> <other>`. A Grant is one way and covers one pair,
  and there is no exception: to call yourself, you are granted yourself.
- **You are never asked who you are.** The Host spawned your process and
  owns your pipe, so it already knows. You hold no token and no port, and
  there is nothing for you to leak.
- **Your own request numbers stay yours.** The Host answers with the id you
  gave and never one of its own, so number your requests however you like.
- **You may say how long your call is allowed to take.** Add a `timeoutMs`
  beside the `plugin`, and the Host waits that many milliseconds for the
  other Plugin Server:

  ```json
  {"plugin":"scheduler","name":"its-tool","arguments":{},"timeoutMs":180000}
  ```

  Leave it out and your call gets thirty seconds, which is right when a
  person is waiting on a page and wrong for work that takes minutes with
  nobody watching. It is a word to the Host and never to the other Plugin:
  its tool is handed the `arguments` and nothing else. It must be a whole
  number of milliseconds above zero, and anything else is refused with a
  sentence.
- **The Host keeps a ceiling on it.** `FIRSTMATE_MAX_CALL_MS`, ten minutes
  by default, is the longest it will wait. Ask for more and you quietly get
  the ceiling rather than a refusal, so you never have to know the operator's
  number to be allowed to run.
- **Running out of time cancels nothing.** The Host lets go and hands you a
  sentence; the other Plugin Server keeps working, its late answer is
  dropped, and nothing else on that pipe is disturbed. A call that runs out
  of time never means the tool did not run.
- **The handshake tells you it is there.** The `initialize` the Host sends
  you carries `capabilities.experimental.firstmate.toolBus`.
- **Every refusal is a sentence**, as a JSON-RPC error: you hold no Grant
  for that Plugin, no Plugin is registered under that name, it is Stopped,
  it ships no Plugin Server, or the chain has passed through too many
  Plugins.
- **A Plugin Page cannot do this.** The Tool Bus is on the pipe, and a
  browser holds no end of it. Your page reaches your Plugin and no other.

## Sending a Notice

Your Plugin Server can ask the App to show the operator a Windows pop-up:
a **Notice**. Write one JSON-RPC request on your stdout, on the same pipe
([ADR-0014](adr/0014-a-notice-travels-on-the-pipe-and-the-poll.md)):

```json
{"jsonrpc":"2.0","id":1,"method":"firstmate/notice",
 "params":{"title":"Build done","body":"All 12 steps passed.","path":"runs/7.html"}}
```

The Host answers on your stdin with your id and `"result":{}`. That means
"accepted" and nothing more: the Host promises nothing about delivery.

- **Your name comes first.** The operator sees `<your Plugin Name>: <title>`.
  You cannot speak as FirstMate or as another Plugin.
- **A click opens your own address.** `path` is relative to `/p/<name>/`.
  Leave it out and a click opens your Plugin Page's root.
- **The limits.** `title` is a string of 1 to 64 characters. `body` is a
  string of at most 200 characters, and may be empty. `path`, if given, is a
  string that stays under `/p/<name>/`. You may send one Notice every 5 s.
- **Every refusal is a sentence**, as a JSON-RPC error: a title or a body
  that is missing, is not a string or is too long; a path that leaves your
  address; a Notice sent less than 5 s after your last one. The Host never
  cuts your text short, and never drops a Notice in silence. A refused
  Notice is not shown.
- **Nobody may be watching.** In 2.0 the App holds the Host, so it hears
  each Notice the moment the Host takes it, and shows it as a Windows
  pop-up under FirstMate's own name. The Host also keeps a Notice for a minute
  (`FIRSTMATE_NOTICE_MS`) at `/notices.json`, for any other reader. When the
  App is not running, or nobody reads it in that time, it is gone. The Host
  writes nothing of it to disk.
- **The handshake tells you it is there.** The `initialize` the Host sends
  you carries `capabilities.experimental.firstmate.notice`.
- **A Plugin Page cannot send one.** Give your Plugin Server a tool that
  sends it, and call that tool from your page.

The Host sends Notices of its own too: when your Plugin goes **Stopped**,
the operator sees `FirstMate: <name> is Stopped` and why, and a click opens
the Index Page.

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
| `Running`          | Your Plugin Server started and answered the handshake. |
| `Stopped`          | It could not be run, exited, or would not answer.   |
| `no Plugin Server` | There is no Plugin Server file. This is allowed.    |

`no Plugin Server` is not a failure. A Plugin that is only a page is a
Plugin.

Two things follow, and both are deliberate:

- **A Stopped Plugin still serves its Plugin Page.** You can open your page
  and debug a broken Plugin Server from it.
- **The Host will never start it again.** A broken Plugin stays visible
  rather than spinning in a restart loop behind the operator's back. Fix it
  and run `firstmate restart <name>`.

One Stopped Plugin leaves every other Plugin serving.

---

# What the project advises

None of this is enforced. All of it is what the first Plugin learned.

- **Write a Node 24 Plugin with an `mcp.ts`.** It is the one form that runs
  on every system the App runs on, with no build step and no Node of the
  operator's own: the Host runs it with its own Node (ADR-0028). Other
  languages stay welcome. Ship `mcp`, with `mcp.exe` or `mcp.cmd` beside it
  for Windows, as above, and expect to do the work below by hand.
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
  - Keep your data in files git ignores: name them in your `.gitignore`.
    `firstmate update` moves a clone of your Plugin forward to your newest
    commit and never touches the files git ignores, so the data survives
    every update
    ([ADR-0030](adr/0030-update-moves-a-git-clone-forward.md)). A data file
    that git tracks is a local change, and `update` refuses to move a clone
    that has one.
  - Ship a fix by pushing a commit. An operator who installed your Plugin
    from its git URL takes it with `firstmate update <name>`. Nothing runs
    after an update, so a fix that needs a new program fetches it on first
    use, as above.
- **Expect no scheduler.** The Host runs nothing on a timer
  ([ADR-0004](adr/0004-the-host-owns-no-scheduler.md)). If your Plugin
  needs one, it brings its own.
- **Do not read the Host's runtime file, and do not print the token.**
  Nothing in `$FIRSTMATE_HOME` is yours.
- **Bring everything you need.** A Plugin carries, or fetches on first use,
  each program and file it needs, so that it works after `firstmate
  install` with nothing else done. Its Plugin Page says what is still
  missing and how to get it.
  - Keep a fetched binary inside your own directory, never in a system
    path. Check it against a SHA-256 that you know before you run it.
  - Fetch on first use, never at `firstmate install`. Nothing runs at
    install, and the Host runs nothing on your behalf either.
  - Do not bundle a tool that belongs to the operator's own account, such
    as `claude`. Let the operator set it from your Plugin Page.
- **Start other programs the same way on every system.**
  - Start a program and a list of arguments, with no shell. Then no
    quoting rule of any shell can change what the arguments mean.
  - Start a `.cmd` or `.bat` file through `cmd.exe`, and pass nothing that
    `cmd.exe` would interpret.
  - End a command that runs too long with its whole process tree: the
    process group on Linux, `taskkill /T /F` on Windows. Ending only the
    first process leaves its children running.
  - Build every path with `node:path` and `node:os`, never with a `/` or a
    `\` of your own.
- **Keep the settings your operator chooses in your own directory.** A
  settings file there, which your Plugin Page edits. An environment
  variable of the same meaning beats the file, and the file beats the
  default. A time or a limit that only a test changes can stay an
  environment variable alone. The Host keeps no settings for you
  ([ADR-0005](adr/0005-plugins-own-their-data.md)).
  - Your Plugin Page edits the file through your own tools. Your Plugin
    Server offers a tool that reads the settings and one that changes
    them, and the page calls them over `rpc`, as it calls any other tool
    (`POST /p/<name>/rpc`). The page cannot write a file itself: everything
    under `web/` is read-only.
  - The tool that changes a setting checks it, writes the whole file
    through a rename, and answers with the settings as they now are, or
    with a sentence that says why it refused.
  - Show your settings at `#settings` of your Plugin Page:
    `/p/<name>/#settings`. The Settings View of the App has an Open
    settings button for every Plugin with a Plugin Page, and it opens that
    address in your Plugin's own view
    ([ADR-0029](adr/0029-a-plugins-settings-are-at-settings-of-its-plugin-page.md)).
    Read `location.hash` when the page loads and on every `hashchange`:
    when your page is already open, only the fragment changes, and the
    page does not load again. The fragment never reaches the Host.
  - A Plugin with no settings may ignore the fragment. The button then
    opens its Plugin Page as it always opens. There is nothing to declare:
    the App never asks whether you have settings, and never reads them.
- **Say nothing when nothing is wrong.** Your stderr is the operator's
  log, shared with the Host and every other Plugin. Earn each line.

## Before you register it

- [ ] The directory is at an absolute path you are happy to leave it at.
- [ ] The name is lower-case letters, digits and single hyphens.
- [ ] An `mcp.ts`, which runs everywhere but a `wsl` Place. In another
  language, `chmod +x mcp`, with `mcp.exe` or `mcp.cmd` beside it on
  Windows — check this first when the Plugin is Stopped.
- [ ] `node mcp.ts`, or `./mcp`, runs from the Plugin directory without an
  import error.
- [ ] It answers `initialize` within ten seconds.
- [ ] Nothing but JSON-RPC goes to stdout. Diagnostics go to stderr.
- [ ] `web/index.html` exists, if you ship a page.
- [ ] Every path in the page is relative.
- [ ] No token, anywhere, in anything you wrote.
- [ ] Every program it needs is bundled, or fetched on first use and checked
  against a SHA-256, and the Plugin Page says what is missing.
- [ ] It starts other programs with no shell, and ends a long one with its
  whole process tree.
- [ ] Its settings are in a file in its own directory, and an environment
  variable beats the file.
- [ ] If it has settings, its Plugin Page shows them at `#settings`.

Then:

```sh
firstmate add <name> /absolute/path/to/your/plugin
```

The running Host picks it up with no restart. After you fix a Stopped Plugin,
`firstmate restart <name>` starts it again.

Open the Index Page. If it says `Stopped`, the reason is in
`firstmate logs`.

## Three worked examples

**The smallest one that is complete.** `tests/fixtures/node-form/` is a whole
Plugin Server in the recommended form: one `mcp.ts`, about forty lines, that
answers `initialize`, and `tools/call`, with no build, no `mcp.cmd` and no
executable bit. Add a `web/` directory beside it and it has a page.
`tests/fixtures/both/` is the same Plugin in Python, with a page, an `mcp`
and an `mcp.cmd`; it is in Python to show that the Host does not care what a
Plugin Server is written in, and it is the form for another language.

**One that brings what it needs.** Say your Plugin runs a program that the
operator does not have. Fetch it the first time a tool needs it, check it
against a SHA-256 you wrote into your code, and keep it under your Plugin
directory, which is your working directory:

```ts
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// One URL and one hash for each system you support, by process.platform.
const TOOL = { url: 'https://example.com/tool-1.2.0-linux-x64', sha256: '<hex>' };
const PATH = join('bin', process.platform === 'win32' ? 'tool.exe' : 'tool');

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The program's path, fetched and checked the first time it is needed. */
async function tool(): Promise<string> {
  const held = await readFile(PATH).catch(() => null);
  if (held !== null && sha256(held) === TOOL.sha256) return PATH;
  const answer = await fetch(TOOL.url);
  if (!answer.ok) throw new Error(`${TOOL.url} answered ${answer.status}.`);
  const bytes = Buffer.from(await answer.arrayBuffer());
  if (sha256(bytes) !== TOOL.sha256) {
    throw new Error(`${TOOL.url} is not the file this Plugin expects.`);
  }
  await mkdir('bin', { recursive: true });
  await writeFile(`${PATH}.part`, bytes);
  await chmod(`${PATH}.part`, 0o755);
  await rename(`${PATH}.part`, PATH);
  return PATH;
}
```

Then offer a tool, such as `status`, that says what is still missing and how
to get it, in a sentence: `tool is not here yet. It downloads on first use,
about 40 MB.` Your Plugin Page calls it over `rpc` and shows that sentence,
so the operator learns what is missing on the page and not from the log. A
fetch that fails is a tool error with a sentence too, and the page shows it.

**A real one.** Nexus is FirstMate's first Plugin.
[`nexus-migration.md`](nexus-migration.md) records what it once had to
build for itself — a loopback listener, a static allowlist, a run token, a
tray — and what it deleted when the Host gave it all four. That document is
the argument for this one. Nexus is a Python Plugin, so it shows the `mcp`
form, not `mcp.ts`, and it stays on Linux alone until
[luanAfons0/nexus#71](https://github.com/luanAfons0/nexus/issues/71).
