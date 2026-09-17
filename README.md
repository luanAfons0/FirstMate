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

## Run the Host

```sh
node src/main.ts
```

It listens on `http://127.0.0.1:4747/` and on no other address.

## Configure it

| Variable          | Default        | What it moves                                   |
| ----------------- | -------------- | ----------------------------------------------- |
| `FIRSTMATE_HOME`  | `~/.firstmate` | Where the Registry and the runtime file live.   |
| `FIRSTMATE_PORT`  | `4747`         | The port. Zero asks the system for a free one.  |

## The home directory

- `registry.json` — the Registry: one row per Plugin, holding its Plugin Name,
  the absolute path of its directory, and its Grants.
- `runtime.json` — the port the Host listened on and the token it minted. It is
  rewritten at every start and removed when the Host stops.

## Addresses

| Address           | What it serves                                |
| ----------------- | --------------------------------------------- |
| `/`               | The Index Page: every Plugin, and its state.  |
| `/p/<name>/`      | That Plugin's `web/` directory, byte for byte. |

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
