# FirstMate

FirstMate is a local plugin host. It runs a person's own tools on their own
machine and gives each one a process, a page and an address, so that no tool has
to build a runtime of its own.

A Plugin is a directory and nothing more. Put a `web/` folder in it and the Host
serves it as a Plugin Page. Put an executable named `mcp` in it and the Host
starts that Plugin Server. A directory with neither is still a Plugin; it just
has nothing to show.

The words this project uses are defined in [`CONTEXT.md`](CONTEXT.md). The
decisions that are expensive to reverse are in [`docs/adr/`](docs/adr).

## What a Plugin is

A directory, named in the Registry. There is no manifest and no schema.

| In the directory   | What the Host does with it                                  |
| ------------------ | ----------------------------------------------------------- |
| `web/`             | Serves it at `/p/<name>/`, byte for byte.                   |
| `mcp` (executable) | Runs it, and speaks MCP to it over stdin and stdout.        |

The shebang of `mcp` decides the language, so a Plugin Server can be written in
anything. Its output goes to the Host's own output, which under systemd is the
journal.

A Plugin is in one of three states, and the Index Page shows which:

| State              | What it means                                              |
| ------------------ | ---------------------------------------------------------- |
| `Running`          | The Plugin Server is up and answered the MCP handshake.     |
| `Stopped`          | The Plugin Server exited, or could not be run at all.       |
| `no Plugin Server` | The Plugin ships no `mcp` file. This is allowed.            |

The Host never starts a Stopped Plugin again, so a broken Plugin stays visible
instead of spinning in a restart loop. A Stopped Plugin still serves its Plugin
Page.

## Add a Plugin

```sh
node src/cli.ts add <name> /absolute/path/to/the/directory
node src/cli.ts remove <name>
node src/cli.ts list
```

Adding neither copies nor symlinks the directory: the Registry holds the path,
so a Plugin stays in its own repository wherever it already lives. The Registry
is read when the Host starts, so restart the Host to pick up a change.

## Run the Host

```sh
node src/main.ts
```

It listens on `http://127.0.0.1:4747/` and on no other address.

## Configure it

| Variable                | Default        | What it moves                                     |
| ----------------------- | -------------- | ------------------------------------------------- |
| `FIRSTMATE_HOME`        | `~/.firstmate` | Where the Registry and the runtime file live.     |
| `FIRSTMATE_PORT`        | `4747`         | The port. Zero asks the system for a free one.    |
| `FIRSTMATE_HANDSHAKE_MS`| `10000`        | How long a Plugin Server has to answer the handshake. |

## The home directory

- `registry.json` — the Registry: one row per Plugin, holding its Plugin Name,
  the absolute path of its directory, and its Grants.
- `runtime.json` — the port the Host listened on and the token it minted. It is
  rewritten at every start and removed when the Host stops.

## Addresses

| Address              | What it serves                                     |
| -------------------- | -------------------------------------------------- |
| `/`                  | The Index Page: every Plugin, and its state.       |
| `/plugins.json`      | The same list, for the Tray. Nothing is written.   |
| `/p/<name>/`         | That Plugin's `web/` directory, byte for byte.     |
| `POST /p/<name>/rpc` | That Plugin's tools. The body is an MCP request.   |

A Plugin Page is a whole page: the Host links to it and the browser goes there,
rather than framing it under chrome of its own
([ADR-0008](docs/adr/0008-a-plugin-page-is-a-whole-page.md)).

## Call a Plugin's tools

A Plugin Page calls its own tools with one ordinary request. There is no bridge
API to learn:

```js
const answer = await fetch('rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
```

The Host forwards that body to the Plugin's Plugin Server and returns the
answer. A Plugin Page may reach only its own Plugin. From a terminal:

```sh
curl -X POST -H 'content-type: application/json'   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   "http://127.0.0.1:4747/p/<name>/rpc?token=<token>"
```

## Reach it

The Host mints a token when it starts and refuses every request that does not
carry it. The address it prints at startup carries the token once:

```
FirstMate: http://127.0.0.1:4747/?token=<token>
```

Open that address and the Host answers with a host-only `SameSite=Strict`
cookie and sends the browser to the same address without the parameter, so the
relative paths inside a Plugin Page are never disturbed. Every later request is
admitted on the cookie alone.

From a terminal, pass the token on every call:

```sh
curl "http://127.0.0.1:4747/p/<name>/?token=<token>"
```

The Host also refuses a request whose `Host` header it does not answer to, one
carrying an `Origin` that is not its own, one carrying the literal `Origin` of
`null`, and one a foreign site started. Each refusal is a 403 that says which
check it failed.

## Keep it running

The Host is a systemd user service inside WSL Debian, with a Windows Task
Scheduler entry at logon that starts WSL and holds the distribution up. Both
halves, with the exact commands to install and to remove them, are in
[`docs/deploy.md`](docs/deploy.md).

```sh
scripts/install-service.sh          # install and start it
journalctl --user -u firstmate -f   # read it
scripts/uninstall-service.sh        # remove it
```

## Open it from Windows

The Tray is a notification-area icon that opens the Index Page in one click. It
holds the Host's port and token in memory, so opening makes no `wsl.exe` call
and no file read.

Its **Plugins** submenu lists every Plugin with its state and opens any one of
them directly, so moving between Plugins never goes through the Index Page. The
list is asked for when the menu opens, so it is never stale.

Install it with `windows/install-tray.ps1`, remove it with
`windows/uninstall-tray.ps1`; both are in
[`docs/deploy.md`](docs/deploy.md).

## The first Plugin

`~/.nexus` is FirstMate's first Plugin. The Host serves its `web/` directory as
a Plugin Page with every relative path unchanged, and starts its `mcp` file as
a Plugin Server. Nexus deleted its own listener, its Run File and its tray once
this replaced them, and keeps no copy of any of the three.

The migration is finished. What moved, and what it proved, is written down in
[`docs/nexus-migration.md`](docs/nexus-migration.md).

## Test it

```sh
node --test
```

Every test boots a real Host against a temporary home directory and drives it
over HTTP. No test imports a module of the Host.

## Check the types

```sh
npm install
npx tsc --noEmit
```

Node 24 runs TypeScript without a build step, so `typescript` is needed only to
check the types.
