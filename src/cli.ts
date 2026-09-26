#!/usr/bin/env node
/**
 * FirstMate from a terminal: run the Host, and keep the Registry it reads.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node src/cli.ts start
 *   node src/cli.ts setup
 *   node src/cli.ts desktop
 *   node src/cli.ts add <name> <directory>
 *   node src/cli.ts remove <name>
 *   node src/cli.ts list
 *   node src/cli.ts grant <from> <to>
 *   node src/cli.ts revoke <from> <to>
 *   node src/cli.ts shelf [directory]
 *   node src/cli.ts install <directory|git-url|official-name> [name]
 *   node src/cli.ts bind <keys> <plugin> [path]
 *   node src/cli.ts unbind <keys>
 *   node src/cli.ts service on|off
 */
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  bindShortcut,
  checkKeys,
  givePermission,
  installPlugin,
  moveShelf,
  notAPluginName,
  takePermission,
  withShortcuts,
} from './commands.ts';
import { readConfig, type Config } from './config.ts';
import { OFFICIAL_PLUGINS } from './official-plugins.ts';
import { isPluginName, readRegistry, writeRegistry, type PluginRow } from './registry.ts';
import { readSettings, writeSettings } from './settings.ts';
import { setup } from './setup.ts';
import { shortcutAddress } from './shortcut.ts';
import { SHELF_VARIABLE } from './shelf.ts';
import { serviceOff, serviceOn } from './service.ts';

const OFFICIAL_NAMES = OFFICIAL_PLUGINS.map((plugin) => plugin.name).join(', ');

const USAGE = `usage:
  firstmate start                    run the Host until it is stopped.
  firstmate setup                    answer a few questions, and have FirstMate set up.
  firstmate desktop                  open the FirstMate window. Windows only.
  firstmate add <name> <directory>   register a Plugin. The directory is not copied.
  firstmate remove <name>            take a Plugin out of the Registry.
  firstmate list                     every Plugin in the Registry.
  firstmate grant <from> <to>        let <from> call <to>'s tools.
  firstmate revoke <from> <to>       take that Grant back.
  firstmate shelf [directory]        say where a fetched Plugin lands, or move it.
  firstmate install <source> [name]  fetch a Plugin into the Shelf and register it.
  firstmate bind <keys> <plugin> [path]
                                     open a Plugin's address from a Shortcut in Windows.
  firstmate unbind <keys>            free that Shortcut's keys.
  firstmate service on|off           run the Host as a systemd user service, or stop.

The Shelf is the directory a fetched Plugin lands in. A source is a directory,
which is copied, a git URL, which is cloned, or the name of an Official Plugin,
which is cloned from where FirstMate knows it is: ${OFFICIAL_NAMES}. install
registers what it put there, under the last segment of the source or under the
name you give.
${SHELF_VARIABLE} moves the Shelf for one run; firstmate shelf <directory>
moves it for good, and that directory has to be there already.

setup asks where the Shelf is, and each answer is written as it is given, by the
same code the plain commands use. It never removes anything. Answers can be
piped in, one per line.

The window works out which distribution holds the Host and where the Host keeps
its home directory. Say them yourself with --distribution <name> and
--home <path> when it cannot.

A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path. A Grant is one way:
granting <from> the right to call <to> does not let <to> call <from>.

A Shortcut is one or more of Ctrl, Alt, Shift and Win and one key, joined by
+, as in Ctrl+Alt+N. The path is relative to the Plugin's address; leave it out
to open the Plugin Page. The Tray picks up a Shortcut with no restart.

The Registry is read when the Host starts, so restart the Host to pick up a
change: systemctl --user restart firstmate`;

/** What the operator did wrong, as against what went wrong. */
const USAGE_FAULT = 2;

async function main(argv: readonly string[]): Promise<number | undefined> {
  const [command, ...rest] = argv;
  // Read only by the commands that use it. The Host reads its own, and the
  // window runs on Windows, where this machine's settings mean nothing; and
  // --help has to work while an environment variable holds nonsense.
  const home = (): string => readConfig().home;

  switch (command) {
    case 'start':
      return start(rest);
    case 'desktop':
      return desktop(rest);
    case 'setup':
      if (rest.length > 0) {
        console.error(`firstmate: setup takes nothing. It asks.\n\n${USAGE}`);
        return USAGE_FAULT;
      }
      return setup();
    case 'add':
      return add(home(), rest);
    case 'remove':
      return remove(home(), rest);
    case 'list':
      return list(home(), rest);
    case 'grant':
      return grant(home(), rest);
    case 'revoke':
      return revoke(home(), rest);
    case 'shelf':
      return shelf(readConfig(), rest);
    case 'install':
      return install(readConfig(), rest);
    case 'bind':
      return bind(home(), rest);
    case 'unbind':
      return unbind(home(), rest);
    case 'service':
      return service(rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return command === undefined ? USAGE_FAULT : 0;
    default:
      console.error(`firstmate: no such command: ${command}\n\n${USAGE}`);
      return USAGE_FAULT;
  }
}

/**
 * Run the Host in this process.
 *
 * The Host's entry point starts the Host as it is imported, so importing it is
 * the whole of this command. Nothing is copied out of `src/main.ts`, which is
 * what keeps `firstmate start` and `node src/main.ts` the same Host, reading
 * the same environment variables and printing the same output.
 */
async function start(argv: readonly string[]): Promise<number | undefined> {
  if (argv.length > 0) {
    console.error(`firstmate: start takes nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  await import('./main.ts');
  // The Host owns the process now, and its exit code with it. It ends on a
  // signal, and sets its own code when it could not start at all, which may
  // be before or after this line runs; a code set here would overwrite it.
  return undefined;
}

/**
 * Open the FirstMate window.
 *
 * The window is imported here rather than at the top of this file, because it
 * is the one part of FirstMate that has a dependency, and every other command
 * must keep working on a machine where that dependency's native binary will not
 * load (ADR-0011). `start` is imported the same way, for a reason of its own.
 */
async function desktop(argv: readonly string[]): Promise<number> {
  let distribution: string | undefined;
  let home: string | undefined;

  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (value === undefined || (flag !== '--distribution' && flag !== '--home')) {
      console.error(
        'firstmate: desktop takes --distribution <name> and --home <path>, and ' +
          `works both out when you leave them out.\n\n${USAGE}`,
      );
      return USAGE_FAULT;
    }
    if (flag === '--distribution') distribution = value;
    else home = value;
  }

  const { openWindow } = await import('./desktop.ts');
  return openWindow({ distribution, home });
}

function add(home: string, argv: readonly string[]): number {
  const [name, directory] = argv;
  if (name === undefined || directory === undefined || argv.length > 2) {
    console.error(`firstmate: add takes a Plugin Name and a directory.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  if (!isPluginName(name)) {
    console.error(`firstmate: ${notAPluginName(name)}`);
    return 1;
  }
  if (!isAbsolute(directory)) {
    console.error(`firstmate: ${directory} is not an absolute path.`);
    return 1;
  }
  const found = statSync(directory, { throwIfNoEntry: false });
  if (found === undefined || !found.isDirectory()) {
    console.error(`firstmate: ${directory} is not a directory.`);
    return 1;
  }

  const rows = readRegistry(home);
  const taken = rows.find((row) => row.name === name);
  if (taken !== undefined) {
    console.error(`firstmate: ${name} is already registered, at ${taken.directory}.`);
    return 1;
  }

  writeRegistry(home, [...rows, { name, directory, grants: [] }]);
  console.log(`firstmate: added ${name} at ${directory}`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

function remove(home: string, argv: readonly string[]): number {
  const [name] = argv;
  if (name === undefined || argv.length > 1) {
    console.error(`firstmate: remove takes one Plugin Name.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  const rows = readRegistry(home);
  const left = rows.filter((row) => row.name !== name);
  if (left.length === rows.length) {
    console.error(`firstmate: no Plugin named ${name} is registered.`);
    return 1;
  }

  // The Shortcuts go first: a Shortcut that outlived its Plugin would open an
  // address that answers nothing, and a failure after this leaves the Plugin
  // registered and the command safe to run again.
  const settings = readSettings(home);
  const shortcuts = settings.shortcuts ?? [];
  const dropped = shortcuts.filter((shortcut) => shortcut.plugin === name);
  if (dropped.length > 0) {
    writeSettings(
      home,
      withShortcuts(
        settings,
        shortcuts.filter((s) => s.plugin !== name),
      ),
    );
  }

  writeRegistry(home, left);
  // The directory itself is untouched. The Host stops serving and running it.
  console.log(`firstmate: removed ${name}`);
  for (const shortcut of dropped) {
    console.log(`firstmate: unbound ${shortcut.keys}, which opened ${shortcutAddress(shortcut)}`);
  }
  console.log('firstmate: restart the Host to pick it up. The directory is untouched.');
  return 0;
}

function grant(home: string, argv: readonly string[]): number {
  const [from, to] = argv;
  if (from === undefined || to === undefined || argv.length > 2) {
    console.error(`firstmate: grant takes two Plugin Names: <from> <to>.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  if (!givePermission(home, from, to)) {
    console.log(`firstmate: ${from} can already call ${to}'s tools.`);
    return 0;
  }
  console.log(`firstmate: granted ${from} the right to call ${to}'s tools.`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

function revoke(home: string, argv: readonly string[]): number {
  const [from, to] = argv;
  if (from === undefined || to === undefined || argv.length > 2) {
    console.error(`firstmate: revoke takes two Plugin Names: <from> <to>.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  if (!takePermission(home, from, to)) {
    console.log(`firstmate: ${from} was never granted the right to call ${to}'s tools.`);
    return 0;
  }
  console.log(`firstmate: took back ${from}'s right to call ${to}'s tools.`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/**
 * Say where a fetched Plugin lands, or move it.
 *
 * Moving it is a write, and the caller's right to make it comes from the
 * terminal the command was typed into. There is no address on the Host that
 * does this, because every Plugin Page shares the Index Page's origin and
 * could therefore send a request the Host cannot tell from the Index Page's
 * own (ADR-0012).
 */
function shelf(config: Config, argv: readonly string[]): number {
  const [directory] = argv;
  if (argv.length > 1) {
    console.error(`firstmate: shelf takes one directory, or nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  if (directory === undefined) {
    console.log(`firstmate: the Shelf is ${config.shelf}`);
    return 0;
  }

  const moved = moveShelf(config.home, directory);
  console.log(`firstmate: the Shelf is now ${moved.shelf}`);
  if (moved.forced !== undefined) {
    console.log(
      `firstmate: ${SHELF_VARIABLE} is set to ${moved.forced}, and wins until it is unset.`,
    );
  }
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/**
 * Fetch a Plugin into the Shelf and register it, in one step. The source is a
 * directory, a git URL, or the name of an Official Plugin (ADR-0015).
 */
async function install(config: Config, argv: readonly string[]): Promise<number> {
  const [source, given] = argv;
  if (source === undefined || argv.length > 2) {
    console.error(
      `firstmate: install takes a source, and a Plugin Name where the source ` +
        `does not name one.\n\n${USAGE}`,
    );
    return USAGE_FAULT;
  }

  const row = await installPlugin(config, source, given);
  console.log(`firstmate: installed ${row.name} at ${row.directory}`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/** Bind keys to one address of one Plugin, for the Tray to hold in all of Windows. */
function bind(home: string, argv: readonly string[]): number {
  const [typed, plugin, path = ''] = argv;
  if (typed === undefined || plugin === undefined || argv.length > 3) {
    console.error(`firstmate: bind takes keys, a Plugin Name, and a path or nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  const shortcut = bindShortcut(home, typed, plugin, path);
  console.log(`firstmate: bound ${shortcut.keys} to open ${shortcutAddress(shortcut)}`);
  return 0;
}

/** Free a Shortcut's keys. A key that is not bound is a typing error, and says so. */
function unbind(home: string, argv: readonly string[]): number {
  const [typed] = argv;
  if (typed === undefined || argv.length > 1) {
    console.error(`firstmate: unbind takes the keys of one Shortcut.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  const keys = checkKeys(typed);
  const settings = readSettings(home);
  const shortcuts = settings.shortcuts ?? [];
  const held = shortcuts.find((shortcut) => shortcut.keys === keys);
  if (held === undefined) {
    console.error(`firstmate: ${keys} is not bound.`);
    return 1;
  }

  writeSettings(
    home,
    withShortcuts(
      settings,
      shortcuts.filter((s) => s !== held),
    ),
  );
  console.log(`firstmate: unbound ${keys}, which opened ${shortcutAddress(held)}`);
  return 0;
}

/** Run the Host as a systemd user service, or stop running it as one. */
function service(argv: readonly string[]): number {
  const [what] = argv;
  if (argv.length !== 1 || (what !== 'on' && what !== 'off')) {
    console.error(`firstmate: service takes on or off.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  if (what === 'on') serviceOn();
  else serviceOff();
  return 0;
}

function list(home: string, argv: readonly string[]): number {
  if (argv.length > 0) {
    console.error(`firstmate: list takes nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  // An empty Registry says nothing, as an empty directory listing says nothing.
  for (const row of readRegistry(home)) console.log(describe(row));
  for (const shortcut of readSettings(home).shortcuts ?? []) {
    console.log(`${shortcut.keys}\topens ${shortcutAddress(shortcut)}`);
  }
  return 0;
}

function describe(row: PluginRow): string {
  const grants = row.grants.length === 0 ? '' : `  grants: ${row.grants.join(', ')}`;
  return `${row.name}\t${row.directory}${grants}`;
}

try {
  const code = await main(process.argv.slice(2));
  if (code !== undefined) process.exitCode = code;
} catch (fault: unknown) {
  console.error(`firstmate: ${fault instanceof Error ? fault.message : String(fault)}`);
  process.exitCode = 1;
}
