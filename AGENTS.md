# FirstMate

FirstMate is a local plugin host. One Host process gives every Plugin a
process, a page and an address, so that no tool has to build a runtime of its
own. You work on the Host, and the Host is only four things: a process
supervisor, an HTTP server on loopback, a static file server, and a JSON-RPC
client.

Read [`CONTEXT.md`](CONTEXT.md) first. It defines every word this repo uses —
Host, Plugin, Plugin Page, Plugin Server, Registry, Index Page, Tray, Grant,
Tool Bus, Stopped — and the synonyms to avoid. Use its words in code, in
comments, in tests, in issues and in commit messages.

Read the ADR that covers the area you are about to change:
[`docs/adr/`](docs/adr). If your change contradicts one, say so out loud
instead of overriding it quietly.

## Commands

Run every command from the repository root.

| Command                              | What it does                                    |
| ------------------------------------ | ----------------------------------------------- |
| `node --test`                        | Every test. This is the whole test suite.       |
| `node --test tests/security.test.ts` | One test file, while you work on it.            |
| `npm install && npx tsc --noEmit`    | Check the types. `npm run typecheck` is the same. |
| `node src/main.ts`                   | Run the Host at `http://127.0.0.1:4747/`.       |
| `node src/cli.ts list`               | Every Plugin in the Registry.                   |
| `node src/cli.ts add <name> <dir>`   | Register a Plugin. `<dir>` is an absolute path. |
| `node src/cli.ts remove <name>`      | Take a Plugin out of the Registry.              |
| `scripts/install-service.sh`         | Install and start the systemd user service.     |
| `journalctl --user -u firstmate -f`  | Read what the running Host says.                |

Three environment variables move the Host: `FIRSTMATE_HOME` (default
`~/.firstmate`), `FIRSTMATE_PORT` (default `4747`; zero asks the system for a
free port) and `FIRSTMATE_HANDSHAKE_MS` (default `10000`, how long a Plugin
Server has to answer the handshake). Tests use all three.

`npm test` and `npm run typecheck` must both pass before you call work done.

## Tech stack

- **Node 24**, which runs TypeScript with no build step. There is no bundler,
  no transpiler and no watcher.
- **TypeScript 5.8**, `strict`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`. `typescript` is a dev dependency and is used only to
  check the types.
- **No runtime dependencies.** The Host speaks MCP over stdio with about 140
  lines of its own JSON-RPC (`src/mcp.ts`) rather than take a dependency. Keep
  it that way.
- **Windows PowerShell** (`powershell.exe`, not `pwsh`) for the Tray and the
  logon task, **systemd** for the
  service, **WSL Debian** for the machine it all runs on (ADR-0007).

## Project structure

```
src/         the Host. Every file is one job.
  main.ts          start-up: read the Registry, mint the token, supervise, listen.
  cli.ts           the Registry from a terminal: add, remove, list, grant, revoke.
  config.ts        FIRSTMATE_HOME and FIRSTMATE_PORT, and nothing else.
  registry.ts      read and write registry.json, whole, through a rename.
  runtime.ts       write and remove runtime.json: the port and the token.
  host.ts          the HTTP surface: /, /p/<name>/…, POST /p/<name>/rpc.
  security.ts      the check every request passes: Host, Origin, token, cookie.
  static-files.ts  a Plugin's web/ directory, byte for byte, never outside it.
  index-page.ts    the Index Page, one file with no assets of its own.
  supervisor.ts    start every Plugin Server, and hold the truth about each.
  mcp.ts           one JSON-RPC connection to one Plugin Server, over stdio.
  tool-call.ts     forward a Plugin Page's tool call to its Plugin Server.
tests/       one file per behaviour, plus fixtures/ and helpers/host.ts.
docs/adr/    the decisions that are expensive to reverse.
docs/agents/ how an agent works in this repo. See "Agent skills" below.
docs/brand/  the anchor, at the sizes GitHub asks for.
scripts/     install and uninstall the systemd user service.
systemd/     the unit file.
windows/     the Tray and the logon task, in PowerShell, with its two icons.
```

## Code style

One real file header and one real function say more than a style guide:

```ts
/**
 * Where the Host keeps its state and which port it listens on.
 *
 * Both come from the environment. The home directory override is what lets a
 * test boot a real Host against a temporary directory, which is the single
 * seam this project tests through.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** The environment variable that moves the Host's home directory. */
export const HOME_VARIABLE = 'FIRSTMATE_HOME';

export type Config = {
  /** The absolute path of the Host's home directory. */
  readonly home: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return { home: readHome(env) };
}
```

What that shows, and what every file follows:

- A file starts with a header comment: what this file is, then why it is that
  way. Every exported name carries a one-line `/** … */`.
- Comments say **why**, in the project's words, and name the ADR when a
  decision is behind the code (`(ADR-0003)`).
- Plain functions and object literals. No classes, no default exports, no
  inheritance, no framework.
- `readonly` on every field of an exported type. Data in, data out.
- Node built-ins carry the `node:` prefix. Local imports carry the `.ts`
  extension, because Node runs the TypeScript directly.
- Single quotes, semicolons, two-space indent, lines under 100 columns. There
  is no formatter config; match the file you are in.
- Errors are sentences a person can act on:
  `` `The Registry at ${path} needs a "plugins" array.` ``. Fail loudly and
  early; say nothing when nothing is wrong.

## Testing

`node --test`. Every test boots a real Host against a temporary home directory
and drives it over HTTP, exactly as a browser does.

- **No test imports a module of the Host.** The one seam is
  `tests/helpers/host.ts`, which spawns `src/main.ts` and returns `fetch`,
  `raw`, `port`, `token`, `home` and `output()`. Keep it that way: it is what
  lets the whole inside of the Host be rewritten without touching a test.
- A test asserts on what a browser and the Tray can see: status codes, headers,
  response bytes, and the files the Host writes into its home directory.
- A fixture Plugin is a directory under `tests/fixtures/`: `both`,
  `page-only`, `server-only`, `quitter`, `unrunnable`. Add a fixture rather
  than a mock.
- A test name is a sentence about behaviour:
  `'a request that leaves the web directory does not'`.

## Git workflow

- Branch `main`. The remote is GitHub: `luanAfons0/FirstMate`, so use `gh`.
- A commit subject is one imperative sentence in the project's own words, with
  no prefix, no scope and no ticket number: `Refuse every request that is not
  mine`, `Start Plugin Servers and show their state`.
- One commit is one whole, working change: code, tests and docs together.
- Never add attribution, co-author or "generated by" lines.

## Boundaries

✅ **Always**

- Read `CONTEXT.md` and the ADRs of the area first, and use their words.
- Keep tests black-box, over HTTP, through `tests/helpers/host.ts`.
- Update `README.md` when you change a command, an address or a variable.
- Leave `npm test` and `npm run typecheck` green.

⚠️ **Ask first**

- Any `git add`, `git commit`, `git push`, or anything that opens a PR.
- Adding a runtime dependency, or any dependency at all.
- Changing the Plugin contract: the `web/` directory, the `mcp` executable, the
  shape of `registry.json`, or an address under `/p/<name>/`.
- Anything that reverses an ADR, and anything that adds a manifest or a schema
  for Plugins (ADR-0002).
- Installing, removing or restarting the systemd service or the Tray, and
  anything that writes inside `~/.firstmate` or `~/.nexus`.

🚫 **Never**

- Bind anything but `127.0.0.1` (ADR-0007), or weaken a check in
  `src/security.ts` to make a test pass.
- Restart a Stopped Plugin. A broken Plugin stays visible instead of spinning
  in a restart loop.
- Read or write a Plugin's data, or keep run history, logs or settings for it
  (ADR-0005).
- Let a Plugin Page reach another Plugin. v1 stores Grants and enforces none.
- Give the Host a scheduler (ADR-0004), a build step, or a front-end framework.
- Print or commit the token, `runtime.json`, or anything from
  `$FIRSTMATE_HOME`.
- Rewrite, wrap, inject into or frame a Plugin Page (ADR-0008). The bytes are
  the Plugin's own.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luanAfons0/FirstMate`, driven by the `gh` CLI.
See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its name. See
[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context: one `CONTEXT.md` and one `docs/adr/` at the repo root. See
[`docs/agents/domain.md`](docs/agents/domain.md).
