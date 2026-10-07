# FirstMate

FirstMate is a local plugin host. One Host process gives every Plugin a
process, a page and an address, so that no tool has to build a runtime of its
own. You work on the Host, and the Host is only four things: a process
supervisor, an HTTP server on loopback, a static file server, and a JSON-RPC
client.

Read [`CONTEXT.md`](CONTEXT.md) first. It defines every word this repo uses —
App, Host, Place, Plugin, Plugin Page, Plugin Server, Registry, Plugin Order,
Index Page, Tray, Settings View, Grant, Tool Bus, Stopped — and the synonyms to
avoid. Use its words in code, in
comments, in tests, in issues and in commit messages.

Read the ADR that covers the area you are about to change:
[`docs/adr/`](docs/adr). If your change contradicts one, say so out loud
instead of overriding it quietly.

## Commands

Run every command from the repository root.

| Command                              | What it does                                    |
| ------------------------------------ | ----------------------------------------------- |
| `pnpm install`                       | Install the dev tools. Do this once, first.     |
| `node --test`                        | Every test. This is the whole test suite.       |
| `node --test tests/security.test.ts` | One test file, while you work on it.            |
| `pnpm typecheck`                     | Check the types with `tsc --noEmit`.            |
| `pnpm lint`                          | Lint with Biome. Warnings fail too.             |
| `pnpm format`                        | Format with Prettier. `format:check` only looks. |
| `pnpm knip`                          | Find unused files, exports and dependencies.    |
| `pnpm check`                         | All of the above, then every test. CI runs it.  |
| `pnpm build`                         | Bundle `apps/cli` into `apps/cli/dist/`. Packing does this; you do not. |
| `pnpm --filter @firstmate/desktop package` | Build the App, and its installer, into `apps/desktop/dist/`. Windows or Linux. |
| `apps\desktop\dist\win-unpacked\FirstMate.exe` | Run the packaged App without installing it. Set `FIRSTMATE_HOME` first. |
| `apps/desktop/dist/linux-unpacked/firstmate-app` | The same on Linux. Set `FIRSTMATE_HOME` first. |
| `node packages/host/src/main.ts`                   | Run the Host at `http://127.0.0.1:4747/`.       |
| `node apps/cli/src/cli.ts setup`              | Ask a few questions, and set FirstMate up.      |
| `node apps/cli/src/cli.ts desktop`            | Install the App of this version, and open it. Windows, Linux or WSL. |
| `node apps/cli/src/cli.ts --help`             | Every command in its group, in one screen.      |
| `node apps/cli/src/cli.ts <command> --help`   | How one command is typed. `help <command>` says the same. |
| `node apps/cli/src/cli.ts help [<topic>]`     | The help topics: exit-codes, environment, places. |
| `node apps/cli/src/cli.ts list`               | Every Plugin in the Registry.                   |
| `node apps/cli/src/cli.ts status`             | Whether the Host runs, and each Plugin's state. |
| `node apps/cli/src/cli.ts restart <name>`     | Start one Plugin's Plugin Server again.         |
| `node apps/cli/src/cli.ts logs [-f]`          | What the Host and its Plugin Servers said.      |
| `node apps/cli/src/cli.ts place [add <name> <kind> \| remove <name>]` | Say every Place, or add or remove one. |
| `node apps/cli/src/cli.ts import <place>`     | Bring a 1.x install across from a wsl Place.    |
| `node apps/cli/src/cli.ts add <name> <dir> [--place <name>]` | Register a Plugin. `<dir>` is an absolute path. |
| `node apps/cli/src/cli.ts remove <name>`      | Take a Plugin out of the Registry.              |
| `node apps/cli/src/cli.ts grant <from> <to>`  | Let `<from>` call `<to>`'s tools: a Grant.      |
| `node apps/cli/src/cli.ts revoke <from> <to>` | Take that Grant back.                           |
| `node apps/cli/src/cli.ts shelf [dir] [--place <name>]` | Say where a fetched Plugin lands, or move it.   |
| `node apps/cli/src/cli.ts install <dir\|url\|official-name> [name] [--place <name>]` | Fetch a Plugin into the Shelf and register it. |
| `node apps/cli/src/cli.ts bind <keys> <plugin> [path]` | Bind a Shortcut to a Plugin address.  |
| `node apps/cli/src/cli.ts unbind <keys>`      | Free a Shortcut's keys.                         |
| `node apps/cli/src/cli.ts order [<name> <position>]` | Say the Plugin Order, or move one Plugin in it. |

Six environment variables move the Host: `FIRSTMATE_HOME` (default
`~/.firstmate`, and `%APPDATA%\FirstMate` on Windows), `FIRSTMATE_PORT` (default `4747`; zero asks the system for a
free port), `FIRSTMATE_HANDSHAKE_MS` (default `10000`, how long a Plugin
Server has to answer the handshake), `FIRSTMATE_MAX_CALL_MS` (default
`600000`, the longest a Tool Bus call may ask the Host to wait),
`FIRSTMATE_NOTICE_MS` (default `60000`, how long the Host holds a Notice for
`/notices.json`) and `FIRSTMATE_SHELF` (default `$FIRSTMATE_HOME/shelf`, the Shelf a
fetched Plugin lands in). Tests use all six. The Shelf is the one setting that does not come
from the environment alone: the variable beats the settings file, which beats
the default (ADR-0012).

One more moves the command line alone: `FIRSTMATE_RELEASES_URL` (default
`https://github.com/luanAfons0/FirstMate/releases/download`), where
`firstmate desktop` downloads the App from. Its tests point it at a server of
their own.

`pnpm check` must pass before you call work done: types, lint, format,
knip and every test.

## Tech stack

- **Node 24**, which runs TypeScript with no build step. The Host and the
  command line need no bundler, no transpiler and no watcher in a clone.
  Publishing to npm bundles `apps/cli` with `tsdown`, because Node strips no
  types under `node_modules` and `core` and `host` are never published; that
  build is on the publish path (ADR-0017). The one other build is the App's:
  `electron-vite` bundles `apps/desktop`, and `electron-builder` packs it
  (ADR-0020).
- **pnpm**, as a workspace, with no Turbo. `packageManager` in `package.json`
  names the version, and pnpm and CI both switch to it.
- **TypeScript 5.8**, `strict`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`. `typescript` is a dev dependency and is used only to
  check the types.
- **Biome, Prettier and knip**, as dev dependencies, for the lint, the layout
  and the dead code, and **tsdown** in `apps/cli`, for the bundle. None of them
  runs in the Host or ships in the package.
- **No runtime dependency.** The Host speaks MCP over stdio with about 140
  lines of its own JSON-RPC (`packages/host/src/mcp.ts`) rather than take a
  dependency. Keep it that way. The npm package is the command line alone, one
  bundled file that depends on nothing (ADR-0024). That bundle carries
  `@clack/prompts`, a devDependency of `apps/cli` and nothing else, for the
  questions asked on a terminal; the Host still takes no dependency
  (ADR-0025). `install` runs the `git`
  binary to clone a Plugin, and a `wsl` Place runs `wsl.exe`: external tools
  the command line assumes, not package dependencies.
- **Electron 44**, in `apps/desktop`, for the App: its main process holds the
  Host, and its executable, told `ELECTRON_RUN_AS_NODE=1`, is the Node every
  Plugin Server gets as `FIRSTMATE_NODE`. Keep Electron's `RunAsNode` fuse on.
  **electron-vite** builds it, **electron-builder** packages it as a
  per-user NSIS installer, unsigned for the betas, and **electron-updater**
  keeps it up to date. All four are dev dependencies of a private package, so
  the bundle carries the updater, and the App's build is not on the npm
  publish path (ADR-0020). One tag releases both: the installer on the GitHub
  Release, then the command line on npm, with one version. The installer's
  and its checksum's names are a contract `firstmate desktop` reads
  (ADR-0023, `.github/workflows/release.yml`).
- **Windows and Linux** for the App, which holds the Tray, the window, Notices and
  Shortcuts with Electron's own features: no PowerShell helper and no systemd
  (ADR-0020, ADR-0026). **WSL** only as a Place a Plugin can run in, on Windows (ADR-0021).

## Project structure

A pnpm workspace. `core` and `host` are private: they are never published.
`core` reaches the npm package inside the bundle `apps/cli` builds, and `host`
reaches the App inside the bundle `apps/desktop` builds; the command line
carries no Host (ADR-0024). `core` imports nothing from `host`, and `apps/cli`
imports nothing from `host` either.

```
packages/core/src/  what the command line and the Host share. Imports nothing
                    from host.
  commands.ts      what the writing commands change, apart from how they are
                   typed and printed, so every refusal has one sentence.
  refusal.ts       the kind of each refusal, which the terminal reads as its
                   exit code.
  official-plugins.ts the Official Plugins, as data: name, URL, one line,
                   and whether each calls other Plugins (ADR-0015).
  config.ts        FIRSTMATE_HOME, FIRSTMATE_PORT, the handshake and the Shelf.
  registry.ts      read and write registry.json, whole, through a rename.
  runtime.ts       write and remove runtime.json: the port and the token.
  settings.ts      read and write settings.json: the Shelf, the Places, the
                   Shortcuts and the Plugin Order.
  places.ts        the Places, as data: the default one, the kinds, and how
                   each is read from the settings file (ADR-0021).
  plugin-places.ts each Plugin as the Host holds it: where its files are
                   read, and how its Plugin Server starts.
  wsl.ts           wsl.exe, as the command line asks it about a wsl Place.
  import-1x.ts     bring a 1.x install across from a wsl Place: Plugins,
                   Grants, Shortcuts, Plugin Order and Shelf.
  shortcut.ts      read the keys of a Shortcut into one normal form, for the
                   terminal and the App alike.
  plugin-state.ts  what the Host says about a Plugin Server, in one set of
                   words for the Index Page, the App and the terminal.
  theme.ts         the one look of every page: the colours, dark and light,
                   the radii, the state shapes, and the icons as one sprite.
  logon.ts         the App's logon entry, which the App and setup both write.
  shelf.ts         where a fetched Plugin lands: resolve it, and check one.
  fetch-plugin.ts  put a Plugin's files in the Shelf: copy a directory, clone
                   a git URL, and run none of what lands.
packages/host/src/  the Host. Every file is one job.
  start.ts         start the Host: read the Registry, mint the token,
                   supervise, listen; and stop it. The App calls it too.
  main.ts          the Host as a process: start it, and stop it on a signal.
  host.ts          the HTTP surface: /, /plugins.json, /shortcuts.json,
                   /notices.json, POST /reload, POST /restart/<name>,
                   /p/<name>/…, POST /p/<name>/rpc.
  security.ts      the check every request passes: Host, Origin, token, cookie.
  static-files.ts  a Plugin's web/ directory, byte for byte, never outside it.
  index-page.ts    the Index Page, one file with no assets of its own.
  supervisor.ts    start every Plugin Server, hold the truth about each, and
                   start or stop only what a reload added or removed. On
                   Windows it starts mcp.exe or mcp.cmd (ADR-0019). It
                   starts mcp.ts or mcp.js first, with its own Node
                   (ADR-0028).
  mcp.ts           one JSON-RPC connection to one Plugin Server, over stdio.
  tool-call.ts     forward a Plugin Page's tool call to its Plugin Server.
  tool-bus.ts      carry a call from one Plugin to another, under a Grant.
  notices.ts       hold the Notices for the App, and refuse a bad one.
  log.ts           keep the Host's output, Plugin Servers' stderr with it, in
                   one capped file in the home directory (ADR-0022).
apps/cli/           the npm package, @luan-afonso/firstmate: the command line
                    alone, with no Host and no window (ADR-0024).
  src/cli.ts       the terminal: desktop, setup, place, import, shelf, install,
                   bind, unbind, order, logs, status, restart, and the
                   Registry: add, remove, list, grant, revoke.
  src/version.ts   the version of the command line, read from its own package.json:
                   `--version` says it, and `desktop` installs the App of it.
  src/setup.ts     firstmate setup: the conversation, and nothing else. Each
                   step calls commands.ts.
  src/prompt.ts    ask for text, yes or no, or from a list: with clack on a
                   terminal, over node:readline from a pipe (ADR-0025).
  src/progress.ts  a long wait on a terminal: a spinner, or a progress bar
                   when its size is known. From a pipe it shows nothing.
  src/terminal.ts  colour, and rows in aligned columns, only on a terminal.
                   From a pipe a row is the tab-separated line it always was.
  src/running-host.ts the running Host, as the terminal reaches it: over
                   loopback, with the token from the runtime file.
  src/install-app.ts firstmate desktop: download the App of this version from
                   its GitHub Release, check its SHA-256, install it, open it;
                   and whether it is installed and starts at logon.
  src/app-logon.ts start at logon, as setup reaches it: the Run value on
                   Windows and from WSL, the autostart entry on Linux.
  src/one-x.ts     bring a 1.x install across, as import and setup both do.
  tsdown.config.ts the bundle, which runs on the publish path alone.
apps/desktop/       the App, @firstmate/desktop: one Electron program for
                    Windows and Linux. Private; its release is the installers (ADR-0026).
  src/main.ts      the main process: start the Host, hold the one-App lock,
                   wire the parts below together, stop the Host on Quit.
  src/window.ts    the window: the strip, the switcher, the Settings View,
                   and one view for the Index Page and each Plugin Page.
  src/pages.ts     the App's own pages, written as data addresses. The Host
                   never serves them (ADR-0008).
  src/preload.ts   the one preload, on the App's own views and never on a
                   Plugin Page. `ask.ts` reads what it sends.
  src/addresses.ts the Host's addresses, and which owner each belongs to.
  src/host-lists.ts what /plugins.json says, as the App reads it.
  src/tray.ts      the Tray: the marks, the menu, and start at logon.
  src/logon.ts     start at logon: the Run entry setup writes too.
  src/settings.ts  what the Settings View shows, and the changes it asks for,
                   made through core in the main process.
  src/settings-view.ts the Settings View, as a page the App writes.
  src/notices.ts   Notices, as desktop pop-ups under the App's own ID.
  src/shortcuts.ts the Shortcuts, held with globalShortcut.
  src/popup.ts     the Popup a Shortcut opens.
  src/permissions.ts what a Plugin Page may use: clipboard write, and the
                   microphone and a capture, asked once per Plugin.
  src/update.ts    the App's own updates, with electron-updater: downloaded in
                   the background, said in one Notice, installed on Quit.
  src/marks.ts     where the running and stopped marks are.
  resources/icons/ the marks, packed with the App.
  electron.vite.config.ts the build: the main process, with core and host
                   in, and the preload.
  electron-builder.yml the package: FirstMate.exe and its per-user installer.
  scripts/package.ts packaging in three passes: the unpacked App, the
                   installers built from it, and the update feed written
                   last. A release signs between them (ADR-0027).
  signpath/        what SignPath signs: the copies of its two artifact
                   configurations, app and installer.
  build/           what packaging reads: the mark, as icon.ico.
tests/       one file per behaviour, plus fixtures/ and helpers/, for every
             package at once.
docs/adr/    the decisions that are expensive to reverse.
docs/agents/ how an agent works in this repo. See "Agent skills" below.
docs/brand/  the anchor, at the sizes GitHub asks for.
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
  extension, because Node runs the TypeScript directly. An import from another
  package names the package and the file, with no extension:
  `@firstmate/core/registry`.
- Single quotes, semicolons, two-space indent, lines under 100 columns.
  Prettier owns the layout (`.prettierrc.json`); run `pnpm format` and do
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
  `tests/helpers/host.ts`, which spawns `packages/host/src/main.ts`, runs
  `apps/cli/src/cli.ts`, and returns `fetch`,
  `raw`, `port`, `token`, `home` and `output()`. Keep it that way: it is what
  lets the whole inside of the Host be rewritten without touching a test.
- A test asserts on what a browser and the Tray can see: status codes, headers,
  response bytes, and the files the Host writes into its home directory.
- Tests run the source. `tests/build.test.ts` alone builds the bundle, with the
  helper's `build`, and boots it through the same helper with `built`.
- `tests/app.test.ts` alone packages the App, with the helper's `packageApp`,
  and starts the packaged program through the same helper with `app`. It runs
  on Windows and on Linux, and takes about a minute. The App's window has no test.
- A fixture Plugin is a directory under `tests/fixtures/`, such as `both`,
  `page-only`, `server-only`, `quitter`, `unrunnable`, `caller`, `notifier`,
  and `node-form`, `node-js` and `node-first` for the Node form.
  Add a fixture rather than a mock. A fixture with an `mcp` carries its
  Windows form, `mcp.cmd`, beside it (ADR-0019). A fixture with only an
  `mcp.ts` or `mcp.js` needs neither, because the Host runs it with its own
  Node (ADR-0028); knip takes each `mcp.ts` as an entry. A fixture reaches no
  file outside its own directory, so it proves what it holds and nothing more.
- `tests/helpers/plugins.ts` asks a booted Host for one Plugin's state, and
  makes one tool call as a Plugin Page makes it, through `host.ts`.
- `tests/helpers/wsl.ts` fakes `wsl.exe` on `PATH`, and points a `wsl`
  Place's root at a folder of the test's own. `tests/helpers/windows.ts` fakes
  the Windows programs and a GitHub Release, for `firstmate desktop` and the
  logon question of `setup`. `tests/helpers/linux.ts` is a Linux desktop of
  the test's own, with a fake AppImage, and `tests/helpers/release.ts` is the
  fake GitHub Release both of them serve.
- The suite runs on Linux and on Windows, in CI. A test that only makes sense
  on one skips on the other and says why, as `wsl-place.test.ts` does.
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
- Leave `pnpm check` green.

⚠️ **Ask first**

- Any `git add`, `git commit`, `git push`, or anything that opens a PR.
- Adding a runtime dependency, or any dependency at all.
- Changing the Plugin contract: the `web/` directory, the Plugin Server file
  (`mcp.ts`, `mcp.js`, or the `mcp` executable and its Windows forms), the
  shape of `registry.json`, or an address under `/p/<name>/`.
- Anything that reverses an ADR, and anything that adds a manifest or a schema
  for Plugins (ADR-0002).
- Installing, removing or restarting the App, turning its start at logon on
  or off, and anything that writes inside `%APPDATA%\FirstMate`,
  `~/.firstmate` or `~/.nexus`.

🚫 **Never**

- Bind anything but `127.0.0.1` (ADR-0020, which carries the rule of ADR-0007), or weaken a check in
  `packages/host/src/security.ts` to make a test pass.
- Restart a Stopped Plugin on the Host's own account. A broken Plugin stays
  visible instead of spinning in a restart loop, until the operator runs
  `firstmate restart <name>`.
- Read or write a Plugin's data, or keep run history, logs or settings for it
  (ADR-0005).
- Let a Plugin Page reach another Plugin. The Tool Bus is on the pipe, under
  a Grant, and a browser holds no end of it (ADR-0009).
- Give the Host a scheduler (ADR-0004), a front-end framework, or a build step
  anywhere but the publish path (ADR-0017) and the App (ADR-0020).
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
