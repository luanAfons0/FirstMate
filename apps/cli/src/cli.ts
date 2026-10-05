#!/usr/bin/env node
/**
 * FirstMate from a terminal: run the Host, and keep the Registry it reads.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node apps/cli/src/cli.ts start
 *   node apps/cli/src/cli.ts setup
 *   node apps/cli/src/cli.ts desktop
 *   node apps/cli/src/cli.ts add <name> <directory>
 *   node apps/cli/src/cli.ts remove <name>
 *   node apps/cli/src/cli.ts list
 *   node apps/cli/src/cli.ts grant <from> <to>
 *   node apps/cli/src/cli.ts revoke <from> <to>
 *   node apps/cli/src/cli.ts shelf [directory]
 *   node apps/cli/src/cli.ts install <directory|git-url|official-name> [name]
 *   node apps/cli/src/cli.ts bind <keys> <plugin> [path]
 *   node apps/cli/src/cli.ts unbind <keys>
 *   node apps/cli/src/cli.ts order [<name> <position>]
 *   node apps/cli/src/cli.ts service on|off
 */
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  bindShortcut,
  checkKeys,
  givePermission,
  installPlugin,
  movePlugin,
  moveShelf,
  notAPluginName,
  pluginOrder,
  takePermission,
  withoutInOrder,
  withShortcuts,
} from '@firstmate/core/commands';
import { readConfig, type Config } from '@firstmate/core/config';
import { OFFICIAL_PLUGINS } from '@firstmate/core/official-plugins';
import {
  isPluginName,
  readRegistry,
  writeRegistry,
  type PluginRow,
} from '@firstmate/core/registry';
import { readSettings, writeSettings } from '@firstmate/core/settings';
import { setup } from './setup.ts';
import { shortcutAddress } from '@firstmate/core/shortcut';
import { SHELF_VARIABLE } from '@firstmate/core/shelf';
import { serviceOff, serviceOn } from './service.ts';

const OFFICIAL_NAMES = OFFICIAL_PLUGINS.map((plugin) => plugin.name).join(', ');

/** One command: how it is typed, what it does in one line, and what runs it. */
type Command = {
  /** The word typed after `firstmate`. */
  readonly name: string;
  /** What the command takes after its name, as the usage line shows it. */
  readonly takes: string;
  /** What it does, in one line. */
  readonly does: string;
  /**
   * Run it with the words typed after its name. It gives back the exit code,
   * or nothing when the command hands the process to something that sets its
   * own.
   */
  readonly run: (argv: readonly string[]) => Promise<number | undefined> | number | undefined;
};

/**
 * Every command, in the order the usage shows them. A command is one row
 * here, and the usage, the dispatch and the help are all read off this table.
 */
const COMMANDS: readonly Command[] = [
  { name: 'start', takes: '', does: 'run the Host until it is stopped.', run: start },
  {
    name: 'setup',
    takes: '',
    does: 'answer a few questions, and have FirstMate set up.',
    run: setUp,
  },
  { name: 'desktop', takes: '', does: 'open the FirstMate window. Windows only.', run: desktop },
  {
    name: 'add',
    takes: '<name> <directory>',
    does: 'register a Plugin. The directory is not copied.',
    run: (argv) => add(home(), argv),
  },
  {
    name: 'remove',
    takes: '<name>',
    does: 'take a Plugin out of the Registry.',
    run: (argv) => remove(home(), argv),
  },
  {
    name: 'list',
    takes: '',
    does: 'every Plugin in the Registry.',
    run: (argv) => list(home(), argv),
  },
  {
    name: 'grant',
    takes: '<from> <to>',
    does: "let <from> call <to>'s tools.",
    run: (argv) => grant(home(), argv),
  },
  {
    name: 'revoke',
    takes: '<from> <to>',
    does: 'take that Grant back.',
    run: (argv) => revoke(home(), argv),
  },
  {
    name: 'shelf',
    takes: '[directory]',
    does: 'say where a fetched Plugin lands, or move it.',
    run: (argv) => shelf(readConfig(), argv),
  },
  {
    name: 'install',
    takes: '<source> [name]',
    does: 'fetch a Plugin into the Shelf and register it.',
    run: (argv) => install(readConfig(), argv),
  },
  {
    name: 'bind',
    takes: '<keys> <plugin> [path]',
    does: "open a Plugin's address from a Shortcut in Windows.",
    run: (argv) => bind(home(), argv),
  },
  {
    name: 'unbind',
    takes: '<keys>',
    does: "free that Shortcut's keys.",
    run: (argv) => unbind(home(), argv),
  },
  {
    name: 'order',
    takes: '[<name> <position>]',
    does: 'say the Plugin Order, or move one Plugin in it.',
    run: (argv) => order(home(), argv),
  },
  {
    name: 'service',
    takes: 'on|off',
    does: 'run the Host as a systemd user service, or stop.',
    run: service,
  },
];

/** The column every command's one line starts at, in the usage. */
const DOES_COLUMN = 37;

/**
 * One command's usage line. A command too long to leave two spaces before the
 * column says what it does on the line below, at the same column.
 */
function usageLine(command: Command): string {
  const typed = `  firstmate ${command.name}${command.takes === '' ? '' : ` ${command.takes}`}`;
  if (typed.length + 2 <= DOES_COLUMN) return `${typed.padEnd(DOES_COLUMN)}${command.does}`;
  return `${typed}\n${' '.repeat(DOES_COLUMN)}${command.does}`;
}

/** What the usage says after the commands, about the words they take. */
const NOTES = `The Shelf is the directory a fetched Plugin lands in. A source is a directory,
which is copied, a git URL, which is cloned, or the name of an Official Plugin,
which is cloned from where FirstMate knows it is: ${OFFICIAL_NAMES}. install
registers what it put there, under the last segment of the source or under the
name you give.
${SHELF_VARIABLE} moves the Shelf for one run; firstmate shelf <directory>
moves it for good, and that directory has to be there already.

setup asks for the Shelf, the Official Plugins to install, the Grants for those
that call others, Shortcuts, and whether to run the Host as a service. Each
answer is written as it is given, by the same code the plain commands use. It
never removes anything. Answers can be piped in, one per line.

The window works out which distribution holds the Host and where the Host keeps
its home directory. Say them yourself with --distribution <name> and
--home <path> when it cannot.

A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path. A Grant is one way:
granting <from> the right to call <to> does not let <to> call <from>.

A Shortcut is one or more of Ctrl, Alt, Shift and Win and one key, joined by
+, as in Ctrl+Alt+N. The path is relative to the Plugin's address; leave it out
to open the Plugin Page. The Tray picks up a Shortcut with no restart.

The Plugin Order is the order every list of Plugins shows them in. A position
counts from 1 at the top, and the other Plugins keep their order. A Plugin
that was never moved follows the ones that were, in the order it was added.
The Host picks up a new order with no restart.

The Registry is read when the Host starts, so restart the Host to pick up a
change: systemctl --user restart firstmate`;

const USAGE = `usage:
${COMMANDS.map(usageLine).join('\n')}

${NOTES}`;

/** What the operator did wrong, as against what went wrong. */
const USAGE_FAULT = 2;

/**
 * The Host's home directory, read only by the commands that use it. The Host
 * reads its own, and the window runs on Windows, where this machine's settings
 * mean nothing; and --help has to work while an environment variable holds
 * nonsense.
 */
const home = (): string => readConfig().home;

async function main(argv: readonly string[]): Promise<number | undefined> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '-h' || name === '--help') {
    console.log(USAGE);
    return name === undefined ? USAGE_FAULT : 0;
  }
  const command = COMMANDS.find((row) => row.name === name);
  if (command === undefined) {
    console.error(`firstmate: no such command: ${name}\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  return command.run(rest);
}

/**
 * Run the Host in this process.
 *
 * The Host's entry point starts the Host as it is imported, so importing it is
 * the whole of this command. Nothing is copied out of `packages/host`, which
 * is what keeps `firstmate start` and `node packages/host/src/main.ts` the
 * same Host, reading the same environment variables and printing the same
 * output.
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

/** Hold the conversation that sets FirstMate up. It takes no words: it asks. */
function setUp(argv: readonly string[]): Promise<number> | number {
  if (argv.length > 0) {
    console.error(`firstmate: setup takes nothing. It asks.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  return setup();
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

  // The settings go first: a Shortcut that outlived its Plugin would open an
  // address that answers nothing, a place in the Plugin Order would be kept
  // for a later Plugin of the same name, and a failure after this leaves the
  // Plugin registered and the command safe to run again.
  const settings = readSettings(home);
  const shortcuts = settings.shortcuts ?? [];
  const dropped = shortcuts.filter((shortcut) => shortcut.plugin === name);
  const placed = (settings.order ?? []).includes(name);
  if (dropped.length > 0 || placed) {
    writeSettings(
      home,
      withoutInOrder(
        withShortcuts(
          settings,
          shortcuts.filter((s) => s.plugin !== name),
        ),
        name,
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

/**
 * Say the Plugin Order, or move one Plugin in it. The Host reads the order on
 * every request, so a move needs no restart (ADR-0016).
 */
function order(home: string, argv: readonly string[]): number {
  if (argv.length === 0) {
    for (const [at, name] of pluginOrder(home).entries()) console.log(`${at + 1}\t${name}`);
    return 0;
  }
  const [name, position] = argv;
  if (name === undefined || position === undefined || argv.length > 2) {
    console.error(`firstmate: order takes nothing, or a Plugin Name and a position.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  const moved = movePlugin(home, name, position);
  console.log(`firstmate: moved ${name} to position ${moved.indexOf(name) + 1}`);
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
