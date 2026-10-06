#!/usr/bin/env node
/**
 * FirstMate from a terminal: install the App, and keep the Registry and the
 * settings the Host in it reads. It carries no Host of its own (ADR-0024): a
 * command writes the files, and asks the running Host to read them again.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node apps/cli/src/cli.ts [--help | -h]
 *   node apps/cli/src/cli.ts help [<command> | <topic>]
 *   node apps/cli/src/cli.ts setup
 *   node apps/cli/src/cli.ts desktop
 *   node apps/cli/src/cli.ts place [add <name> <kind> [...] | remove <name>] [--json]
 *   node apps/cli/src/cli.ts import <place>
 *   node apps/cli/src/cli.ts add <name> <directory> [--place <name>]
 *   node apps/cli/src/cli.ts remove <name>
 *   node apps/cli/src/cli.ts list [--json]
 *   node apps/cli/src/cli.ts status [--json]
 *   node apps/cli/src/cli.ts restart <name>
 *   node apps/cli/src/cli.ts logs [-f]
 *   node apps/cli/src/cli.ts grant <from> <to>
 *   node apps/cli/src/cli.ts revoke <from> <to>
 *   node apps/cli/src/cli.ts shelf [directory] [--place <name>] [--json]
 *   node apps/cli/src/cli.ts install <directory|git-url|official-name> [name] [--place <name>]
 *   node apps/cli/src/cli.ts bind <keys> <plugin> [path]
 *   node apps/cli/src/cli.ts unbind <keys>
 *   node apps/cli/src/cli.ts order [<name> <position>] [--json]
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import {
  addPlace,
  addPlugin,
  bindShortcut,
  checkKeys,
  findPlace,
  givePermission,
  installPlugin,
  listPlaces,
  movePlugin,
  moveShelf,
  notAPluginName,
  pluginOrder,
  removePlace,
  shelfOf,
  takePermission,
  withoutInOrder,
  withShortcuts,
} from '@firstmate/core/commands';
import { readConfig, type Config } from '@firstmate/core/config';
import { DEFAULT_PLACE } from '@firstmate/core/places';
import { refusalOf, refuse, type Refusal } from '@firstmate/core/refusal';
import { OFFICIAL_PLUGINS } from '@firstmate/core/official-plugins';
import {
  isPluginName,
  readRegistry,
  writeRegistry,
  type PluginRow,
} from '@firstmate/core/registry';
import { logPath, oldLogPath } from '@firstmate/core/runtime';
import { readSettings, writeSettings } from '@firstmate/core/settings';
import { STATE_WORDS, type PluginState } from '@firstmate/core/plugin-state';
import { readHostStatus, reloadHost, restartPlugin } from './running-host.ts';
import { bringAcross } from './one-x.ts';
import { openPrompt } from './prompt.ts';
import { setup } from './setup.ts';
import { bad, good, groupName, printRows, refusalPrefix } from './terminal.ts';
import { ownVersion } from './version.ts';
import { shortcutAddress } from '@firstmate/core/shortcut';
import { SHELF_VARIABLE } from '@firstmate/core/shelf';

const OFFICIAL_NAMES = OFFICIAL_PLUGINS.map((plugin) => plugin.name).join(', ');

/**
 * The groups the short help shows the commands in, in its order. Each one
 * names what its commands are for.
 */
const GROUPS = ['Start', 'Plugins', 'Running', 'Grants and Shortcuts', 'Places'] as const;

/** One of the groups the short help shows the commands in. */
type Group = (typeof GROUPS)[number];

/** One command: how it is typed, what it does in one line, and what runs it. */
type Command = {
  /** The word typed after `firstmate`. */
  readonly name: string;
  /** The group the short help shows it in. */
  readonly group: Group;
  /** What it does in a few words, as the short help shows it. */
  readonly short: string;
  /** What the command takes after its name, as the usage line shows it. */
  readonly takes: string;
  /** What it does, in one line, as its own help shows it. */
  readonly does: string;
  /** Whether it can say what it reads as one JSON value, with --json. */
  readonly json?: true;
  /** Whether it takes `--place <name>`, to act in a Place other than the default. */
  readonly place?: true;
  /**
   * Run it with the words typed after its name, less --json and --place, and
   * what those said. It gives back the exit code, or nothing when the command
   * hands the process to something that sets its own.
   */
  readonly run: (
    argv: readonly string[],
    json: boolean,
    place: string | undefined,
  ) => Promise<number | undefined> | number | undefined;
};

/**
 * Every command, in the order the short help shows them. A command is one row
 * here, and the short help, the dispatch and each command's help are all read
 * off this table.
 */
const COMMANDS: readonly Command[] = [
  {
    name: 'setup',
    group: 'Start',
    short: 'answer a few questions, and set FirstMate up',
    takes: '',
    does: 'answer a few questions, and have FirstMate set up.',
    run: setUp,
  },
  {
    name: 'desktop',
    group: 'Start',
    short: 'install the App, and open it',
    takes: '',
    does: 'install the App of this version, and open it.',
    run: desktop,
  },
  {
    name: 'install',
    group: 'Plugins',
    short: 'fetch a Plugin into the Shelf, and register it',
    takes: '<source> [name]',
    does: 'fetch a Plugin into the Shelf and register it.',
    place: true,
    run: (argv, _json, place) => install(readConfig(), argv, place),
  },
  {
    name: 'add',
    group: 'Plugins',
    short: 'register a Plugin where its directory already is',
    takes: '<name> <directory>',
    does: 'register a Plugin. The directory is not copied.',
    place: true,
    run: (argv, _json, place) => add(home(), argv, place),
  },
  {
    name: 'remove',
    group: 'Plugins',
    short: 'take a Plugin out of the Registry',
    takes: '<name>',
    does: 'take a Plugin out of the Registry.',
    run: (argv) => remove(home(), argv),
  },
  {
    name: 'list',
    group: 'Plugins',
    short: 'say every Plugin in the Registry',
    takes: '',
    does: 'every Plugin in the Registry.',
    json: true,
    run: (argv, json) => list(home(), argv, json),
  },
  {
    name: 'order',
    group: 'Plugins',
    short: 'say the Plugin Order, or move one Plugin in it',
    takes: '[<name> <position>]',
    does: 'say the Plugin Order, or move one Plugin in it.',
    json: true,
    run: (argv, json) => order(home(), argv, json),
  },
  {
    name: 'status',
    group: 'Running',
    short: "say whether the Host runs, and each Plugin's state",
    takes: '',
    does: 'say whether the Host runs, and the state of each Plugin.',
    json: true,
    run: (argv, json) => status(home(), argv, json),
  },
  {
    name: 'restart',
    group: 'Running',
    short: "start one Plugin's Plugin Server again",
    takes: '<name>',
    does: "start one Plugin's Plugin Server again, after you fix it.",
    run: (argv) => restart(home(), argv),
  },
  {
    name: 'logs',
    group: 'Running',
    short: 'print what the Host and its Plugin Servers said',
    takes: '[-f]',
    does: 'print what the Host and its Plugin Servers said. -f follows it.',
    run: (argv) => logs(home(), argv),
  },
  {
    name: 'grant',
    group: 'Grants and Shortcuts',
    short: "let one Plugin call another Plugin's tools",
    takes: '<from> <to>',
    does: "let <from> call <to>'s tools.",
    run: (argv) => grant(home(), argv),
  },
  {
    name: 'revoke',
    group: 'Grants and Shortcuts',
    short: 'take a Grant back',
    takes: '<from> <to>',
    does: 'take that Grant back.',
    run: (argv) => revoke(home(), argv),
  },
  {
    name: 'bind',
    group: 'Grants and Shortcuts',
    short: "open a Plugin's address from a Shortcut",
    takes: '<keys> <plugin> [path]',
    does: "open a Plugin's address from a Shortcut in Windows.",
    run: (argv) => bind(home(), argv),
  },
  {
    name: 'unbind',
    group: 'Grants and Shortcuts',
    short: "free a Shortcut's keys",
    takes: '<keys>',
    does: "free that Shortcut's keys.",
    run: (argv) => unbind(home(), argv),
  },
  {
    name: 'place',
    group: 'Places',
    short: 'say every Place, or add or remove one',
    takes: '[add <name> <kind> [...] | remove <name>]',
    does: 'say every Place, or add or remove one.',
    json: true,
    run: (argv, json) => place(home(), argv, json),
  },
  {
    name: 'shelf',
    group: 'Places',
    short: 'say where a fetched Plugin lands, or move it',
    takes: '[directory]',
    does: 'say where a fetched Plugin lands, or move it.',
    json: true,
    place: true,
    run: (argv, json, place) => shelf(readConfig(), argv, json, place),
  },
  {
    name: 'import',
    group: 'Places',
    short: 'bring a 1.x install across from a wsl Place',
    takes: '<place>',
    does: 'bring a 1.x install across from a wsl Place.',
    run: (argv) => importFrom(home(), argv),
  },
];

/** The column every command's one line starts at, in the usage. */
const DOES_COLUMN = 37;

/**
 * One command's usage line. A command too long to leave two spaces before the
 * column says what it does on the line below, at the same column.
 */
function usageLine(command: Command): string {
  const takes = `${command.takes}${command.place === true ? ' [--place <name>]' : ''}`.trim();
  const typed = `  firstmate ${command.name}${takes === '' ? '' : ` ${takes}`}`;
  if (typed.length + 2 <= DOES_COLUMN) return `${typed.padEnd(DOES_COLUMN)}${command.does}`;
  return `${typed}\n${' '.repeat(DOES_COLUMN)}${command.does}`;
}

/**
 * What a Place is. The commands that act in a Place show it in their help, and
 * it is the places help topic too.
 */
const PLACES_HELP = `A Place is where Plugins are installed and their Plugin Servers run. The
default Place is this machine, and it is always there. add, install and shelf
act in it unless --place names another. Each Place has its own Shelf. A local
Place runs its Plugin Servers on this machine. A wsl Place is one WSL
distribution: add it with place add <name> wsl <distribution>, and give the
Windows path its files are read through when that is not
\\\\wsl.localhost\\<distribution>. Its paths are the distribution's own. A Place
that holds a Plugin cannot be removed, and a Plugin Name is used once across
every Place.`;

/** A paragraph of help, and the commands whose own help shows it. */
type Note = {
  /** The commands this paragraph explains. */
  readonly about: readonly string[];
  readonly text: string;
};

/** What each command's own help says after its usage line, about the words it takes. */
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
  { about: ['place', 'add', 'install', 'shelf'], text: PLACES_HELP },
  {
    about: ['import'],
    text: `import reads the 1.x Registry and settings from ~/.firstmate in a wsl Place's
distribution, and brings across its Plugins, their Grants, the Shortcuts, the
Plugin Order and the Shelf. Every Plugin enters that Place where its directory
already is: nothing is copied or moved. A Plugin Name already in use is refused
in one sentence, and the rest still come. When the 1.x Host runs there as a
systemd service, import asks before it turns that service off.`,
  },
  {
    about: ['setup'],
    text: `setup asks, in this order: the Shelf and the Places; whether to import a 1.x
install, when a wsl Place has one; the Official Plugins to install; the Grants
for those that call others; Shortcuts; and whether FirstMate starts at logon.
Each answer is written as it is given, by the same code the plain commands use.
It never removes anything. Answers can be piped in, one per line.`,
  },
  {
    about: ['desktop'],
    text: `desktop downloads the App installer of its own version from the GitHub Release,
checks its SHA-256, installs it for you alone with no administrator, and opens
the App. When that version, or a newer one, is installed, it only opens it. It
runs on Windows, and inside WSL, where it reaches Windows through interop.
FIRSTMATE_RELEASES_URL moves where it downloads from.`,
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
to open the Plugin Page. The App picks up a Shortcut with no restart.`,
  },
  {
    about: ['order'],
    text: `The Plugin Order is the order every list of Plugins shows them in. A position
counts from 1 at the top, and the other Plugins keep their order. A Plugin
that was never moved follows the ones that were, in the order it was added.
The Host picks up a new order with no restart.`,
  },
  {
    about: ['status', 'list', 'order', 'place', 'shelf'],
    text: `status, list, order, place and shelf say what they read as one JSON value with
--json, and print nothing else. A command that changes something prints no JSON.
status reads the running Host, and ends with exit code 6 when none answers.`,
  },
  {
    about: ['logs'],
    text: `logs prints the Host's log: what the Host said, and what every Plugin Server
wrote to stderr. It is one file in the home directory, and it never grows past
its cap: the whole log then moves to firstmate.log.old, which is printed first. With -f it keeps
printing new lines until you stop it with Ctrl-C.`,
  },
  {
    about: ['restart'],
    text: `restart stops one Plugin's Plugin Server, Stopped or not, and starts it again.
The Host never does this by itself: a broken Plugin stays Stopped until you
fix it and say so. restart needs a running Host, and ends with exit code 6
when none answers.`,
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

const ENVIRONMENT_HELP = `The command line reads these environment variables:

FIRSTMATE_HOME moves the home directory, where the Registry, the settings and
the log are. Default: ~/.firstmate, or %APPDATA%\\FirstMate on Windows.

${SHELF_VARIABLE} moves the Shelf of the default Place, for one run.
Default: $FIRSTMATE_HOME/shelf, or the directory firstmate shelf moved it to.

FIRSTMATE_RELEASES_URL moves where desktop downloads the App installer from.
Default: https://github.com/luanAfons0/FirstMate/releases/download

The Host reads FIRSTMATE_PORT and the FIRSTMATE_..._MS variables, and the
README says what they move.`;

/** A help topic: a general note that is about no one command. */
type Topic = {
  /** The word typed after `firstmate help`. */
  readonly name: string;
  /** What it explains in a few words, as the topic list shows it. */
  readonly short: string;
  readonly text: string;
};

/** Every help topic, in the order the topic list shows them. */
const TOPICS: readonly Topic[] = [
  { name: 'exit-codes', short: 'what each exit code means, for a script', text: EXIT_HELP },
  { name: 'environment', short: 'the variables the command line reads', text: ENVIRONMENT_HELP },
  {
    name: 'places',
    short: 'where Plugins are installed, and how to add a Place',
    text: PLACES_HELP,
  },
];

/** Every topic's name, as the short help and a refused topic name them. */
const TOPIC_NAMES = TOPICS.map((topic) => topic.name);

/** One row of the short help or of the topic list: a name, and its few words. */
function shortLine(name: string, short: string, column: number): string {
  return `  ${name.padEnd(column)}${short}`;
}

/**
 * The help that fits in one screen: what FirstMate is, every command in its
 * group with its few words, and where the rest of the help is.
 */
function shortHelp(stream: NodeJS.WriteStream): string {
  return `firstmate: run your own tools on your own machine.

usage: firstmate <command> [...]

${GROUPS.map((group) =>
  [
    groupName(group, stream),
    ...COMMANDS.filter((command) => command.group === group).map((command) =>
      shortLine(command.name, command.short, 9),
    ),
  ].join('\n'),
).join('\n')}

firstmate <command> --help   how one command is typed
firstmate help <topic>       ${TOPIC_NAMES.join(', ')}`;
}

/** The short help, then every topic with its few words, for `firstmate help`. */
function topicList(stream: NodeJS.WriteStream): string {
  return `${shortHelp(stream)}

Topics, for firstmate help <topic>:
${TOPICS.map((topic) => shortLine(topic.name, topic.short, 13)).join('\n')}

firstmate --version          which FirstMate this is (-v too)`;
}

/** One command's own help: its usage line, and every note about it. */
function helpOf(command: Command): string {
  const notes = NOTES.filter((note) => note.about.includes(command.name));
  return [`usage:\n${usageLine(command)}`, ...notes.map((note) => note.text)].join('\n\n');
}

/**
 * Say the help `firstmate help` was asked for: the topic list with no word, a
 * command's own help, or a topic. Anything else is refused in one line.
 */
function help(argv: readonly string[]): number {
  const words = argv.filter((word) => !HELP_WORDS.has(word));
  const [word] = words;
  if (word === undefined) {
    console.log(topicList(process.stdout));
    return exit('done');
  }
  const command = COMMANDS.find((row) => row.name === word);
  const topic = TOPICS.find((row) => row.name === word);
  const text = command === undefined ? topic?.text : helpOf(command);
  if (text === undefined || words.length > 1) {
    const last = TOPIC_NAMES.at(-1);
    const rest = TOPIC_NAMES.slice(0, -1).join(', ');
    const sentence =
      words.length > 1
        ? 'help takes one command or one topic.'
        : `no help topic named ${word}: try ${rest} or ${last}.`;
    console.error(`${refusalPrefix()} ${sentence}`);
    return exit('typed-wrong');
  }
  console.log(text);
  return exit('done');
}

/**
 * Say how a command was typed wrong, then how it is typed, and give back the
 * exit code for that.
 */
function typedWrong(name: string, sentence: string): number {
  const command = COMMANDS.find((row) => row.name === name);
  console.error(
    `firstmate: ${sentence}\n\n${command === undefined ? shortHelp(process.stderr) : helpOf(command)}`,
  );
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

/** The words that ask which FirstMate this is, typed where a command goes. */
const VERSION_WORDS: ReadonlySet<string> = new Set(['-v', '--version']);

/** The fewest single-letter edits that turn one word into another. */
function editDistance(from: string, to: string): number {
  let row = Array.from({ length: to.length + 1 }, (_cell, index) => index);
  for (let i = 1; i <= from.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= to.length; j += 1) {
      const swap = from[i - 1] === to[j - 1] ? 0 : 1;
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + swap));
    }
    row = next;
  }
  return row[to.length] ?? 0;
}

/** The nearest command name, or `help`, within two edits; a tie goes to the first in the table. */
function nearestCommand(word: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const name of [...COMMANDS.map((row) => row.name), HELP_WORD]) {
    const distance = editDistance(word, name);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

/** Refuse a word that is no command in one line, with a guess when one is near. Runs nothing. */
function noSuchCommand(name: string): number {
  const guess = nearestCommand(name);
  const said = guess === undefined ? '.' : `. Did you mean ${guess}?`;
  console.error(
    `${refusalPrefix()} no such command: ${name}${said}\nfirstmate --help says every command.`,
  );
  return exit('typed-wrong');
}

/** The word that asks for a command's help or a topic, typed where a command goes. */
const HELP_WORD = 'help';

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
    console.log(shortHelp(process.stdout));
    return exit(name === undefined ? 'typed-wrong' : 'done');
  }
  if (VERSION_WORDS.has(name)) {
    console.log(`firstmate ${ownVersion()}`);
    return exit('done');
  }
  if (name === HELP_WORD) return help(rest);
  const command = COMMANDS.find((row) => row.name === name);
  if (command === undefined) return noSuchCommand(name);
  if (rest.some((word) => HELP_WORDS.has(word))) {
    console.log(helpOf(command));
    return exit('done');
  }
  const json = rest.includes(JSON_WORD);
  if (json && command.json !== true) return typedWrong(name, `${name} prints no JSON.`);
  const words = rest.filter((word) => word !== JSON_WORD);
  const at = words.indexOf(PLACE_WORD);
  if (at < 0) return command.run(words, json, undefined);
  const place = words[at + 1];
  if (command.place !== true) return typedWrong(name, `${name} takes no ${PLACE_WORD}.`);
  if (place === undefined || place.startsWith('-')) {
    return typedWrong(name, `${PLACE_WORD} takes the name of a Place.`);
  }
  return command.run(
    words.filter((_word, index) => index !== at && index !== at + 1),
    json,
    place,
  );
}

/** The word that names the Place a command acts in, wherever it is typed. */
const PLACE_WORD = '--place';

/** Hold the conversation that sets FirstMate up. It takes no words: it asks. */
function setUp(argv: readonly string[]): Promise<number> | number {
  if (argv.length > 0) {
    return typedWrong('setup', 'setup takes nothing. It asks.');
  }
  return setup();
}

/**
 * Install the App of this command line's version, and open it (ADR-0023).
 *
 * It is imported here rather than at the top of this file, so that no other
 * command loads what only this one needs.
 */
async function desktop(argv: readonly string[]): Promise<number> {
  if (argv.length > 0) {
    return typedWrong('desktop', 'desktop takes nothing.');
  }
  const { installApp } = await import('./install-app.ts');
  return installApp();
}

async function add(home: string, argv: readonly string[], place?: string): Promise<number> {
  const [name, directory] = argv;
  if (name === undefined || directory === undefined || argv.length > 2) {
    return typedWrong('add', 'add takes a Plugin Name and a directory.');
  }
  const row = addPlugin(home, name, directory, place);
  console.log(`firstmate: added ${row.name} at ${row.directory}${inPlace(row.place)}`);
  await reloadHost(home);
  return 0;
}

/**
 * Where a Plugin went, when that is not the default Place. A command in the
 * default Place says what it said before there were Places.
 */
function inPlace(place: string): string {
  return place === DEFAULT_PLACE ? '' : `, in ${place}`;
}

/**
 * Bring a 1.x install across from a `wsl` Place, and offer to turn off the
 * 1.x service there, which would otherwise hold the port the App listens on.
 * A refusal of one thing is said, and the rest still comes; the command then
 * ends with the exit code for a name that is taken.
 */
async function importFrom(home: string, argv: readonly string[]): Promise<number> {
  const [name] = argv;
  if (name === undefined || argv.length > 1) {
    return typedWrong('import', 'import takes the name of one wsl Place.');
  }
  const imported = await bringAcross(home, findPlace(home, name), confirmOnce);
  await reloadHost(home);
  return imported.refused.length === 0 ? 0 : exit('taken');
}

/**
 * Ask one yes or no question, and take no answer for no: a script that
 * pipes nothing in has not agreed to anything.
 */
async function confirmOnce(question: string): Promise<boolean> {
  const prompt = openPrompt(() => process.exit(130));
  try {
    return await prompt.confirm(question, true);
  } catch {
    return false;
  } finally {
    prompt.close();
  }
}

/**
 * Say every Place, or add or remove one. A Place is a setting, written from a
 * terminal or from the App's Settings View, like the Shelf it carries
 * (ADR-0012, ADR-0021).
 */
async function place(home: string, argv: readonly string[], json: boolean): Promise<number> {
  const [what, name, kind, ...needs] = argv;
  if (what === undefined || (what === 'list' && argv.length === 1)) {
    const config = readConfig();
    const places = listPlaces(home).map((one) => ({ ...one, shelf: shelfOf(config, one) }));
    if (json) printJson({ places });
    else {
      printRows(
        ['PLACE', 'KIND', 'SHELF'],
        places.map((one) => ({ cells: [one.name, one.kind, one.shelf] })),
      );
    }
    return 0;
  }
  if (json) return typedWrong('place', 'place prints JSON only when it changes nothing.');
  if (what === 'add' && name !== undefined && kind !== undefined) {
    const added = await addPlace(home, name, kind, needs);
    console.log(`firstmate: added the ${added.kind} Place ${added.name}`);
    await reloadHost(home);
    return 0;
  }
  if (what === 'remove' && name !== undefined && argv.length === 2) {
    removePlace(home, name);
    console.log(`firstmate: removed the Place ${name}. Nothing on disk was touched.`);
    await reloadHost(home);
    return 0;
  }
  return typedWrong(
    'place',
    'place takes nothing, add <name> <kind> and what the kind needs, or remove <name>.',
  );
}

async function remove(home: string, argv: readonly string[]): Promise<number> {
  const [name] = argv;
  if (name === undefined || argv.length > 1) {
    return typedWrong('remove', 'remove takes one Plugin Name.');
  }

  const rows = readRegistry(home);
  const left = rows.filter((row) => row.name !== name);
  if (left.length === rows.length) {
    console.error(`${refusalPrefix()} no Plugin named ${name} is registered.`);
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
async function shelf(
  config: Config,
  argv: readonly string[],
  json: boolean,
  placeName?: string,
): Promise<number> {
  const [directory] = argv;
  if (argv.length > 1) {
    return typedWrong('shelf', 'shelf takes one directory, or nothing.');
  }
  const named = placeName === undefined ? undefined : findPlace(config.home, placeName);
  const of = named === undefined ? '' : ` of ${named.name}`;
  if (directory === undefined) {
    const current = named === undefined ? config.shelf : shelfOf(config, named);
    if (json) printJson({ shelf: current });
    else if (process.stdout.isTTY === true) {
      printRows(['PLACE', 'SHELF'], [{ cells: [named?.name ?? DEFAULT_PLACE, current] }]);
    } else console.log(`firstmate: the Shelf${of} is ${current}`);
    return 0;
  }
  if (json) return typedWrong('shelf', 'shelf prints JSON only when it moves nothing.');

  const moved = moveShelf(config.home, directory, named?.name);
  console.log(`firstmate: the Shelf${of} is now ${moved.shelf}`);
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
async function install(config: Config, argv: readonly string[], place?: string): Promise<number> {
  const [source, given] = argv;
  if (source === undefined || argv.length > 2) {
    return typedWrong(
      'install',
      `install takes a source, and a Plugin Name where the source ` + `does not name one.`,
    );
  }

  const row = await installPlugin(config, source, given, place);
  console.log(`firstmate: installed ${row.name} at ${row.directory}${inPlace(row.place)}`);
  await reloadHost(config.home);
  return 0;
}

/** Bind keys to one address of one Plugin, for the App to hold in all of Windows. */
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
    console.error(`${refusalPrefix()} ${keys} is not bound.`);
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
    else {
      printRows(
        ['POSITION', 'PLUGIN'],
        names.map((name, at) => ({ cells: [String(at + 1), name] })),
      );
    }
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

/**
 * Start one Plugin's Plugin Server again, Stopped or not. The name is checked
 * against the Registry first, so an unknown one is refused in the same words
 * whether a Host runs or not.
 */
async function restart(home: string, argv: readonly string[]): Promise<number> {
  const [name] = argv;
  if (name === undefined || argv.length > 1) {
    return typedWrong('restart', 'restart takes one Plugin Name.');
  }
  if (!isPluginName(name)) throw refuse('invalid', notAPluginName(name));
  if (!readRegistry(home).some((row) => row.name === name)) {
    throw refuse('missing', `no Plugin named ${name} is registered.`);
  }

  const restarted = await restartPlugin(home, name);
  if (restarted === undefined) {
    console.error(`${refusalPrefix()} ${await noHost()}`);
    return exit('no-host');
  }
  if (restarted.state === 'no-plugin-server') {
    console.log(`firstmate: ${name} ships no Plugin Server to restart.`);
    return 0;
  }
  if (restarted.state === 'stopped') {
    console.error(`${refusalPrefix()} ${name} is Stopped: ${restarted.why ?? 'it did not start.'}`);
    return exit('failed');
  }
  console.log(`firstmate: restarted ${name}. It is ${STATE_WORDS[restarted.state]}.`);
  return 0;
}

/**
 * Print the Host's log, the older file first, and with -f keep printing what
 * is added until the operator stops it. A file that rolls over to the older
 * one is read again from its start.
 */
function logs(home: string, argv: readonly string[]): number | undefined {
  const follow = argv.length === 1 && (argv[0] === '-f' || argv[0] === '--follow');
  if (argv.length > 0 && !follow) return typedWrong('logs', 'logs takes -f, or nothing.');
  const path = logPath(home);
  const old = oldLogPath(home);
  if (!existsSync(path) && !existsSync(old)) {
    console.error(`${refusalPrefix()} there is no log yet, at ${path}.`);
    return exit('missing');
  }
  for (const file of [old, path]) {
    if (existsSync(file)) process.stdout.write(readFileSync(file));
  }
  if (!follow) return 0;

  let at = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  setInterval(() => {
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size < at) at = 0;
    if (size === at) return;
    const added = Buffer.alloc(size - at);
    const file = openSync(path, 'r');
    try {
      readSync(file, added, 0, added.length, at);
    } finally {
      closeSync(file);
    }
    process.stdout.write(added);
    at = size;
  }, FOLLOW_MS);
  // The process now lives until it is stopped, and Ctrl-C ends it.
  return undefined;
}

/** How often logs -f looks for new lines. */
const FOLLOW_MS = 200;

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
  printRows(
    ['NAME', 'PLACE', 'DIRECTORY', 'GRANTS'],
    rows.map((row) => ({
      cells: [row.name, row.place, row.directory, row.grants.join(', ')],
      plain: describe(row),
    })),
  );
  printRows(
    ['KEYS', 'OPENS'],
    shortcuts.map((shortcut) => ({
      cells: [shortcut.keys, shortcutAddress(shortcut)],
      plain: `${shortcut.keys}\topens ${shortcutAddress(shortcut)}`,
    })),
  );
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
    else console.log(`firstmate: ${await noHost()}`);
    return exit('no-host');
  }
  if (json) {
    printJson({ running: true, address: seen.address, plugins: seen.plugins });
    return 0;
  }
  console.log(`firstmate: the Host runs at ${seen.address}`);
  printRows(
    ['PLUGIN', 'STATE'],
    seen.plugins.map((plugin) => ({ cells: [plugin.name, stateWord(plugin.state)] })),
  );
  return 0;
}

/**
 * Why no Host answers, in the one sentence that says what to do. Where there
 * is a Windows to hold the App and the App is not on it, the next step is to
 * install it; anywhere else, the Host is simply not running.
 */
async function noHost(): Promise<string> {
  const { appHere } = await import('./install-app.ts');
  const here = await appHere();
  return here !== undefined && here.installed === undefined
    ? 'the App is not installed. Run firstmate desktop to install it.'
    : 'no Host runs.';
}

/** A Plugin's state word, in green when it runs and in red when it is Stopped. */
function stateWord(state: PluginState): string {
  const word = STATE_WORDS[state];
  if (state === 'running') return good(word);
  return state === 'stopped' ? bad(word) : word;
}

function describe(row: PluginRow): string {
  const grants = row.grants.length === 0 ? '' : `  grants: ${row.grants.join(', ')}`;
  return `${row.name}\t${row.place}\t${row.directory}${grants}`;
}

try {
  const code = await main(process.argv.slice(2));
  if (code !== undefined) process.exitCode = code;
} catch (fault: unknown) {
  console.error(`${refusalPrefix()} ${fault instanceof Error ? fault.message : String(fault)}`);
  process.exitCode = exit(refusalOf(fault) ?? 'failed');
}
