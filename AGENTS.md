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
| `npm run lint`                       | Lint with Biome. Warnings fail too.             |
| `npm run format`                     | Format with Prettier. `format:check` only looks. |
| `npm run knip`                       | Find unused files, exports and dependencies.    |
| `npm run check`                      | All of the above, then every test. CI runs it.  |
| `npm run build`                      | Compile into `dist/`. Packing does this; you do not. |
| `node src/main.ts`                   | Run the Host at `http://127.0.0.1:4747/`.       |
| `node src/cli.ts start`              | The same Host, from the command line.           |
| `node src/cli.ts setup`              | Ask a few questions, and set FirstMate up.      |
| `node src/cli.ts desktop`            | The FirstMate window. Windows only.             |
| `node src/cli.ts list`               | Every Plugin in the Registry.                   |
| `node src/cli.ts add <name> <dir>`   | Register a Plugin. `<dir>` is an absolute path. |
| `node src/cli.ts remove <name>`      | Take a Plugin out of the Registry.              |
| `node src/cli.ts shelf [dir]`        | Say where a fetched Plugin lands, or move it.   |
| `node src/cli.ts install <dir\|url\|official-name> [name]` | Fetch a Plugin into the Shelf and register it. |
| `node src/cli.ts bind <keys> <plugin> [path]` | Bind a Shortcut to a Plugin address.  |
| `node src/cli.ts unbind <keys>`      | Free a Shortcut's keys.                         |
| `scripts/install-service.sh`         | Install and start the systemd user service.     |
| `journalctl --user -u firstmate -f`  | Read what the running Host says.                |

Six environment variables move the Host: `FIRSTMATE_HOME` (default
`~/.firstmate`), `FIRSTMATE_PORT` (default `4747`; zero asks the system for a
free port), `FIRSTMATE_HANDSHAKE_MS` (default `10000`, how long a Plugin
Server has to answer the handshake), `FIRSTMATE_MAX_CALL_MS` (default
`600000`, the longest a Tool Bus call may ask the Host to wait),
`FIRSTMATE_NOTICE_MS` (default `60000`, how long the Host holds a Notice for
the Tray) and `FIRSTMATE_SHELF` (default `$FIRSTMATE_HOME/shelf`, the Shelf a
fetched Plugin lands in). Tests use all six. The Shelf is the one setting that does not come
from the environment alone: the variable beats the settings file, which beats
the default (ADR-0012).

`npm run check` must pass before you call work done: types, lint, format,
knip and every test.

## Tech stack

- **Node 24**, which runs TypeScript with no build step. There is no bundler,
  no transpiler and no watcher. Publishing to npm compiles, because Node strips
  no types under `node_modules`; that build is on the publish path alone, and a
  clone never holds its output (ADR-0010).
- **TypeScript 5.8**, `strict`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`. `typescript` is a dev dependency and is used only to
  check the types.
- **Biome, Prettier and knip**, as dev dependencies, for the lint, the layout
  and the dead code. None of them runs in the Host or ships in the package.
- **One runtime dependency, and the Host uses none of it.** The Host speaks MCP
  over stdio with about 140 lines of its own JSON-RPC (`src/mcp.ts`) rather than
  take a dependency. Keep it that way. The desktop program draws its window with
  `@webviewjs/webview`; `src/desktop.ts` imports it when the desktop subcommand
  runs and never when a module loads, so every other command works on a machine
  where the native binary will not load (ADR-0011). `install` runs the `git`
  binary to clone a Plugin: an external tool the command line assumes, not a
  package dependency, and the Host still calls nothing outside Node.
- **Windows PowerShell** (`powershell.exe`, not `pwsh`) for installing and
  removing the Windows side, for the logon task, and for the three things the
  running Tray asks of it: the taskbar button (`src/taskbar.ts`), the
  helper that holds the Shortcuts (`src/hotkeys.ts`) and the helper that shows
  the Notices (`src/notice-helper.ts`), **systemd** for the service, **WSL
  Debian** for the machine it all runs on (ADR-0007). The Tray itself is
  TypeScript, in `src/desktop*.ts`, and runs on Windows Node.

## Project structure

```
src/         the Host. Every file is one job.
  main.ts          start-up: read the Registry, mint the token, supervise, listen.
  cli.ts           the terminal: start, desktop, shelf, install, bind, unbind,
                   and the Registry: add, remove, list, grant, revoke.
  commands.ts      what the writing commands change, apart from how they are
                   typed and printed, so every refusal has one sentence.
  setup.ts         firstmate setup: the conversation, and nothing else. Each
                   step calls commands.ts.
  prompt.ts        ask for text, yes or no, or numbers, over node:readline.
  official-plugins.ts the Official Plugins, as data: name, URL, one line,
                   and whether each calls other Plugins (ADR-0015).
  config.ts        FIRSTMATE_HOME, FIRSTMATE_PORT, the handshake and the Shelf.
  registry.ts      read and write registry.json, whole, through a rename.
  runtime.ts       write and remove runtime.json: the port and the token.
  settings.ts      read and write settings.json: the Shelf and the Shortcuts.
  shortcut.ts      read the keys of a Shortcut into one normal form, for the
                   terminal and the Tray alike.
  shelf.ts         where a fetched Plugin lands: resolve it, and check one.
  fetch-plugin.ts  put a Plugin's files in the Shelf: copy a directory, clone
                   a git URL, and run none of what lands.
  host.ts          the HTTP surface: /, /plugins.json, /shortcuts.json,
                   /notices.json,
                   /p/<name>/…, POST /p/<name>/rpc.
  security.ts      the check every request passes: Host, Origin, token, cookie.
  static-files.ts  a Plugin's web/ directory, byte for byte, never outside it.
  index-page.ts    the Index Page, one file with no assets of its own.
  supervisor.ts    start every Plugin Server, and hold the truth about each.
  mcp.ts           one JSON-RPC connection to one Plugin Server, over stdio.
  tool-call.ts     forward a Plugin Page's tool call to its Plugin Server.
  tool-bus.ts      carry a call from one Plugin to another, under a Grant.
  notices.ts       hold the Notices for the Tray, and refuse a bad one.
  desktop-state.ts the part that decides: where the Host is, and whether it is
                   there. Imports nothing native, owns no window.
  desktop.ts       the part that shows: the window, and the one dependency.
  strip.ts         the chrome strip above the content view, one file with no
                   assets of its own. The Host never serves it.
  logon.ts         whether FirstMate starts at logon: one file in Startup.
  taskbar.ts       the name Windows groups the taskbar button by, so that the
                   button wears FirstMate's mark and not node.exe's.
  hotkeys.ts       the PowerShell helper that holds the Shortcuts in Windows:
                   one command per line in, one event per line out.
  notice-helper.ts the PowerShell helper that shows Notices under FirstMate's
                   own name and mark, and hears a click on one.
tests/       one file per behaviour, plus fixtures/ and helpers/host.ts.
icons/       the mark, running and stopped. The window wears it; the Tray
             draws with both. Packed with the program.
docs/adr/    the decisions that are expensive to reverse.
docs/agents/ how an agent works in this repo. See "Agent skills" below.
docs/brand/  the anchor, at the sizes GitHub asks for.
scripts/     install and uninstall the systemd user service.
systemd/     the unit file.
windows/     install and remove the Windows side, and the logon task that
             holds the distribution up. PowerShell, and nothing else.
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
- Single quotes, semicolons, two-space indent, lines under 100 columns.
  Prettier owns the layout (`.prettierrc.json`); run `npm run format` and do
  not argue with it. Markdown is left alone: prose line breaks are chosen by
  hand.
- Biome (`biome.json`) lints. `biome/no-class.grit` refuses a class. Suppress
  a rule only where the code is right and the rule is wrong, with
  `// biome-ignore lint/<group>/<rule>: <why>`.
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
- Leave `npm run check` green.

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
- Let a Plugin Page reach another Plugin. The Tool Bus is on the pipe, under
  a Grant, and a browser holds no end of it (ADR-0009).
- Give the Host a scheduler (ADR-0004), a front-end framework, or a build step
  anywhere but the publish path (ADR-0010).
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
