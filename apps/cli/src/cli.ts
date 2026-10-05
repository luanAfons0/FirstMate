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
 *   node apps/cli/src/cli.ts list [--json]
 *   node apps/cli/src/cli.ts status [--json]
 *   node apps/cli/src/cli.ts grant <from> <to>
 *   node apps/cli/src/cli.ts revoke <from> <to>
 *   node apps/cli/src/cli.ts shelf [directory] [--json]
 *   node apps/cli/src/cli.ts install <directory|git-url|official-name> [name]
 *   node apps/cli/src/cli.ts bind <keys> <plugin> [path]
 *   node apps/cli/src/cli.ts unbind <keys>
 *   node apps/cli/src/cli.ts order [<name> <position>] [--json]
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
import { refusalOf, type Refusal } from '@firstmate/core/refusal';
import { OFFICIAL_PLUGINS } from '@firstmate/core/official-plugins';
import {
  isPluginName,
  readRegistry,
  writeRegistry,
  type PluginRow,
} from '@firstmate/core/registry';
import { readSettings, writeSettings } from '@firstmate/core/settings';
import { STATE_WORDS } from '@firstmate/host/index-page';
import { readHostStatus, reloadHost } from './running-host.ts';
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
  /** Whether it can say what it reads as one JSON value, with --json. */
  readonly json?: true;
  /**
   * Run it with the words typed after its name, less --json, and whether
   * --json was typed. It gives back the exit code, or nothing when the
   * command hands the process to something that sets its own.
   */
  readonly run: (
    argv: readonly string[],
    json: boolean,
  ) => Promise<number | undefined> | number | undefined;
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
    json: true,
    run: (argv, json) => list(home(), argv, json),
  },
  {
    name: 'status',
    takes: '',
    does: 'say whether the Host runs, and the state of each Plugin.',
    json: true,
    run: (argv, json) => status(home(), argv, json),
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
    json: true,
    run: (argv, json) => shelf(readConfig(), argv, json),
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
    json: true,
    run: (argv, json) => order(home(), argv, json),
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

/** A paragraph of help, and the commands whose own help shows it too. */
type Note = {
  /** The commands this paragraph explains. */
  readonly about: readonly string[];
  readonly text: string;
};

/** What the usage says after the commands, about the words they take. */
const NOTES: readonly Note[] = [
  {
    about: ['shelf', 'install'],
    text: `The Shelf is the directory a fetched Plugin lands in. A source is a directory,
which is copied, a git URL, which is cloned, or the name of an Official Plugin,
which is cloned from where FirstMate knows it is: ${OFFICIAL_NAMES}. install
registers what it put there, under the last segment of the source or under the
name you give.
${SHELF_VARIABLE} moves the Shelf for one run; firstmate shelf <directory>
moves it for good, and that directory has to be there already.`,
  },
  {
    about: ['setup'],
    text: `setup asks for the Shelf, the Official Plugins to install, the Grants for those
that call others, Shortcuts, and whether to run the Host as a service. Each
answer is written as it is given, by the same code the plain commands use. It
never removes anything. Answers can be piped in, one per line.`,
  },
  {
    about: ['desktop'],
    text: `The window works out which distribution holds the Host and where the Host keeps
its home directory. Say them yourself with --distribution <name> and
--home <path> when it cannot.`,
  },
  {
    about: ['add', 'grant', 'revoke', 'install'],
    text: `A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path. A Grant is one way:
granting <from> the right to call <to> does not let <to> call <from>.`,
  },
  {
    about: ['bind', 'unbind'],
    text: `A Shortcut is one or more of Ctrl, Alt, Shift and Win and one key, joined by
+, as in Ctrl+Alt+N. The path is relative to the Plugin's address; leave it out
to open the Plugin Page. The Tray picks up a Shortcut with no restart.`,
  },
  {
    about: ['order'],
    text: `The Plugin Order is the order every list of Plugins shows them in. A position
counts from 1 at the top, and the other Plugins keep their order. A Plugin
that was never moved follows the ones that were, in the order it was added.
The Host picks up a new order with no restart.`,
  },
  {
    about: ['status', 'list', 'order', 'shelf'],
    text: `status, list, order and shelf say what they read as one JSON value with
--json, and print nothing else. A command that changes something prints no JSON.
status reads the running Host, and ends with exit code 6 when none answers.`,
  },
  {
    about: ['add', 'remove', 'grant', 'revoke', 'shelf', 'install', 'bind', 'unbind', 'order'],
    text: `A command that changes the Registry or the settings asks the running Host to
reload: it starts the Plugins added, stops the ones removed, takes the new
Grants, and leaves every other Plugin alone, Stopped or not. With no Host
running, the command writes the files and says nothing more.`,
  },
];

/** Every way a command can end. A refusal says which kind of refusal it is. */
type Ending = 'done' | 'failed' | 'typed-wrong' | Refusal | 'no-host';

/**
 * The exit code of each way a command can end, and what it means, so that a
 * script can tell one refusal from another without reading the sentence.
 * The codes never change meaning: 0 and 2 meant this before there was a table.
 */
const EXIT_CODES: Readonly<Record<Ending, { readonly code: number; readonly means: string }>> = {
  done: { code: 0, means: 'it did what it was asked.' },
  failed: { code: 1, means: 'it failed: a damaged file, a fetch that went wrong, or a fault.' },
  'typed-wrong': { code: 2, means: 'it was typed wrong: no such command, or the wrong words.' },
  invalid: { code: 3, means: 'it refused a value that is not what it must be.' },
  missing: { code: 4, means: 'it refused a Plugin or a Shortcut that is not there.' },
  taken: { code: 5, means: 'it refused a name, keys or a directory that is taken already.' },
  'no-host': { code: 6, means: 'it needs a running Host, and none answers.' },
};

/** The exit code a command ends with. */
function exit(ending: Ending): number {
  return EXIT_CODES[ending].code;
}

const EXIT_HELP = `A command ends with one of these exit codes:
${Object.values(EXIT_CODES)
  .map(({ code, means }) => `  ${code}  ${means}`)
  .join('\n')}`;

const USAGE = `usage:
${COMMANDS.map(usageLine).join('\n')}

${NOTES.map((note) => note.text).join('\n\n')}

${EXIT_HELP}`;

/** One command's own help: its usage line, and every note about it. */
function helpOf(command: Command): string {
  const notes = NOTES.filter((note) => note.about.includes(command.name));
  return [`usage:\n${usageLine(command)}`, ...notes.map((note) => note.text)].join('\n\n');
}

/**
 * Say how a command was typed wrong, then how it is typed, and give back the
 * exit code for that.
 */
function typedWrong(name: string, sentence: string): number {
  const command = COMMANDS.find((row) => row.name === name);
  console.error(`firstmate: ${sentence}\n\n${command === undefined ? USAGE : helpOf(command)}`);
  return exit('typed-wrong');
}

/** The word that asks a reading command for one JSON value, wherever it is typed. */
const JSON_WORD = '--json';

/** Say one value as JSON, and nothing else, for a script to read. */
function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** The words that ask for a command's help, wherever they are typed after it. */
const HELP_WORDS: ReadonlySet<string> = new Set(['-h', '--help']);

/**
 * The Host's home directory, read only by the commands that use it. The Host
 * reads its own, and the window runs on Windows, where this machine's settings
 * mean nothing; and --help has to work while an environment variable holds
 * nonsense.
 */
const home = (): string => readConfig().home;

async function main(argv: readonly string[]): Promise<number | undefined> {
  const [name, ...rest] = argv;
  if (name === undefined || HELP_WORDS.has(name)) {
    console.log(USAGE);
    return exit(name === undefined ? 'typed-wrong' : 'done');
  }
  const command = COMMANDS.find((row) => row.name === name);
  if (command === undefined) return typedWrong(name, `no such command: ${name}`);
  if (rest.some((word) => HELP_WORDS.has(word))) {
    console.log(helpOf(command));
    return exit('done');
  }
  const json = rest.includes(JSON_WORD);
  if (json && command.json !== true) return typedWrong(name, `${name} prints no JSON.`);
  return command.run(
    rest.filter((word) => word !== JSON_WORD),
    json,
  );
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
    return typedWrong('start', 'start takes nothing.');
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
    return typedWrong('setup', 'setup takes nothing. It asks.');
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
      return typedWrong(
        'desktop',
        'desktop takes --distribution <name> and --home <path>, and ' +
          `works both out when you leave them out.`,
      );
    }
    if (flag === '--distribution') distribution = value;
    else home = value;
  }

  const { openWindow } = await import('./desktop.ts');
  return openWindow({ distribution, home });
}

async function add(home: string, argv: readonly string[]): Promise<number> {
  const [name, directory] = argv;
  if (name === undefined || directory === undefined || argv.length > 2) {
    return typedWrong('add', 'add takes a Plugin Name and a directory.');
  }
  if (!isPluginName(name)) {
    console.error(`firstmate: ${notAPluginName(name)}`);
    return exit('invalid');
  }
  if (!isAbsolute(directory)) {
    console.error(`firstmate: ${directory} is not an absolute path.`);
    return exit('invalid');
  }
  const found = statSync(directory, { throwIfNoEntry: false });
  if (found === undefined || !found.isDirectory()) {
    console.error(`firstmate: ${directory} is not a directory.`);
    return exit('invalid');
  }

  const rows = readRegistry(home);
  const taken = rows.find((row) => row.name === name);
  if (taken !== undefined) {
    console.error(`firstmate: ${name} is already registered, at ${taken.directory}.`);
    return exit('taken');
  }

  writeRegistry(home, [...rows, { name, directory, grants: [] }]);
  console.log(`firstmate: added ${name} at ${directory}`);
  await reloadHost(home);
  return 0;
}

async function remove(home: string, argv: readonly string[]): Promise<number> {
  const [name] = argv;
  if (name === undefined || argv.length > 1) {
    return typedWrong('remove', 'remove takes one Plugin Name.');
  }

  const rows = readRegistry(home);
  const left = rows.filter((row) => row.name !== name);
  if (left.length === rows.length) {
    console.error(`firstmate: no Plugin named ${name} is registered.`);
    return exit('missing');
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
  console.log(`firstmate: removed ${name}. Its directory is untouched.`);
  for (const shortcut of dropped) {
    console.log(`firstmate: unbound ${shortcut.keys}, which opened ${shortcutAddress(shortcut)}`);
  }
  await reloadHost(home);
  return 0;
}

async function grant(home: string, argv: readonly string[]): Promise<number> {
  const [from, to] = argv;
  if (from === undefined || to === undefined || argv.length > 2) {
    return typedWrong('grant', 'grant takes two Plugin Names: <from> <to>.');
  }

  if (!givePermission(home, from, to)) {
    console.log(`firstmate: ${from} can already call ${to}'s tools.`);
    return 0;
  }
  console.log(`firstmate: granted ${from} the right to call ${to}'s tools.`);
  await reloadHost(home);
  return 0;
}

async function revoke(home: string, argv: readonly string[]): Promise<number> {
  const [from, to] = argv;
  if (from === undefined || to === undefined || argv.length > 2) {
    return typedWrong('revoke', 'revoke takes two Plugin Names: <from> <to>.');
  }

  if (!takePermission(home, from, to)) {
    console.log(`firstmate: ${from} was never granted the right to call ${to}'s tools.`);
    return 0;
  }
  console.log(`firstmate: took back ${from}'s right to call ${to}'s tools.`);
  await reloadHost(home);
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
async function shelf(config: Config, argv: readonly string[], json: boolean): Promise<number> {
  const [directory] = argv;
  if (argv.length > 1) {
    return typedWrong('shelf', 'shelf takes one directory, or nothing.');
  }
  if (directory === undefined) {
    if (json) printJson({ shelf: config.shelf });
    else console.log(`firstmate: the Shelf is ${config.shelf}`);
    return 0;
  }
  if (json) return typedWrong('shelf', 'shelf prints JSON only when it moves nothing.');

  const moved = moveShelf(config.home, directory);
  console.log(`firstmate: the Shelf is now ${moved.shelf}`);
  if (moved.forced !== undefined) {
    console.log(
      `firstmate: ${SHELF_VARIABLE} is set to ${moved.forced}, and wins until it is unset.`,
    );
  }
  await reloadHost(config.home);
  return 0;
}

/**
 * Fetch a Plugin into the Shelf and register it, in one step. The source is a
 * directory, a git URL, or the name of an Official Plugin (ADR-0015).
 */
async function install(config: Config, argv: readonly string[]): Promise<number> {
  const [source, given] = argv;
  if (source === undefined || argv.length > 2) {
    return typedWrong(
      'install',
      `install takes a source, and a Plugin Name where the source ` + `does not name one.`,
    );
  }

  const row = await installPlugin(config, source, given);
  console.log(`firstmate: installed ${row.name} at ${row.directory}`);
  await reloadHost(config.home);
  return 0;
}

/** Bind keys to one address of one Plugin, for the Tray to hold in all of Windows. */
async function bind(home: string, argv: readonly string[]): Promise<number> {
  const [typed, plugin, path = ''] = argv;
  if (typed === undefined || plugin === undefined || argv.length > 3) {
    return typedWrong('bind', 'bind takes keys, a Plugin Name, and a path or nothing.');
  }

  const shortcut = bindShortcut(home, typed, plugin, path);
  console.log(`firstmate: bound ${shortcut.keys} to open ${shortcutAddress(shortcut)}`);
  await reloadHost(home);
  return 0;
}

/** Free a Shortcut's keys. A key that is not bound is a typing error, and says so. */
async function unbind(home: string, argv: readonly string[]): Promise<number> {
  const [typed] = argv;
  if (typed === undefined || argv.length > 1) {
    return typedWrong('unbind', 'unbind takes the keys of one Shortcut.');
  }

  const keys = checkKeys(typed);
  const settings = readSettings(home);
  const shortcuts = settings.shortcuts ?? [];
  const held = shortcuts.find((shortcut) => shortcut.keys === keys);
  if (held === undefined) {
    console.error(`firstmate: ${keys} is not bound.`);
    return exit('missing');
  }

  writeSettings(
    home,
    withShortcuts(
      settings,
      shortcuts.filter((s) => s !== held),
    ),
  );
  console.log(`firstmate: unbound ${keys}, which opened ${shortcutAddress(held)}`);
  await reloadHost(home);
  return 0;
}

/**
 * Say the Plugin Order, or move one Plugin in it. The Host reads the order on
 * every request, so a move needs no restart (ADR-0016).
 */
async function order(home: string, argv: readonly string[], json: boolean): Promise<number> {
  if (argv.length === 0) {
    const names = pluginOrder(home);
    if (json) printJson({ order: names });
    else for (const [at, name] of names.entries()) console.log(`${at + 1}\t${name}`);
    return 0;
  }
  const [name, position] = argv;
  if (name === undefined || position === undefined || argv.length > 2) {
    return typedWrong('order', 'order takes nothing, or a Plugin Name and a position.');
  }
  if (json) return typedWrong('order', 'order prints JSON only when it moves nothing.');
  const moved = movePlugin(home, name, position);
  console.log(`firstmate: moved ${name} to position ${moved.indexOf(name) + 1}`);
  await reloadHost(home);
  return 0;
}

/** Run the Host as a systemd user service, or stop running it as one. */
function service(argv: readonly string[]): number {
  const [what] = argv;
  if (argv.length !== 1 || (what !== 'on' && what !== 'off')) {
    return typedWrong('service', 'service takes on or off.');
  }
  if (what === 'on') serviceOn();
  else serviceOff();
  return 0;
}

function list(home: string, argv: readonly string[], json: boolean): number {
  if (argv.length > 0) {
    return typedWrong('list', 'list takes nothing.');
  }
  const rows = readRegistry(home);
  const shortcuts = readSettings(home).shortcuts ?? [];
  if (json) {
    printJson({
      plugins: rows,
      shortcuts: shortcuts.map((shortcut) => ({
        ...shortcut,
        address: shortcutAddress(shortcut),
      })),
    });
    return 0;
  }
  // An empty Registry says nothing, as an empty directory listing says nothing.
  for (const row of rows) console.log(describe(row));
  for (const shortcut of shortcuts) {
    console.log(`${shortcut.keys}\topens ${shortcutAddress(shortcut)}`);
  }
  return 0;
}

/**
 * Say whether the Host runs and the state of each Plugin, in the Plugin
 * Order, as the running Host itself tells it. With no Host, there is no state
 * to tell: a Plugin Server runs only under a Host.
 */
async function status(home: string, argv: readonly string[], json: boolean): Promise<number> {
  if (argv.length > 0) {
    return typedWrong('status', 'status takes nothing.');
  }
  const seen = await readHostStatus(home);
  if (seen === undefined) {
    if (json) printJson({ running: false });
    else console.log('firstmate: no Host runs.');
    return exit('no-host');
  }
  if (json) {
    printJson({ running: true, address: seen.address, plugins: seen.plugins });
    return 0;
  }
  console.log(`firstmate: the Host runs at ${seen.address}`);
  for (const plugin of seen.plugins) console.log(`${plugin.name}\t${STATE_WORDS[plugin.state]}`);
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
  process.exitCode = exit(refusalOf(fault) ?? 'failed');
}
