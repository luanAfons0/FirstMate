#!/usr/bin/env node
/**
 * FirstMate from a terminal: run the Host, and keep the Registry it reads.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node src/cli.ts start
 *   node src/cli.ts desktop
 *   node src/cli.ts add <name> <directory>
 *   node src/cli.ts remove <name>
 *   node src/cli.ts list
 *   node src/cli.ts grant <from> <to>
 *   node src/cli.ts revoke <from> <to>
 *   node src/cli.ts shelf [directory]
 *   node src/cli.ts install <source> [name]
 */
import { mkdirSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { readConfig, type Config } from './config.ts';
import {
  isPluginName,
  readRegistry,
  registryPath,
  writeRegistry,
  type PluginRow,
} from './registry.ts';
import { writeSettings } from './settings.ts';
import { checkShelf, defaultShelf, SHELF_VARIABLE, shelfInEnvironment } from './shelf.ts';
import { fetchPlugin } from './fetch-plugin.ts';

const USAGE = `usage:
  firstmate start                    run the Host until it is stopped.
  firstmate desktop                  open the FirstMate window. Windows only.
  firstmate add <name> <directory>   register a Plugin. The directory is not copied.
  firstmate remove <name>            take a Plugin out of the Registry.
  firstmate list                     every Plugin in the Registry.
  firstmate grant <from> <to>        let <from> call <to>'s tools.
  firstmate revoke <from> <to>       take that Grant back.
  firstmate shelf [directory]        say where a fetched Plugin lands, or move it.
  firstmate install <source> [name]  fetch a Plugin into the Shelf and register it.

The Shelf is the directory a fetched Plugin lands in. install copies a
directory into it and registers what it copied, under the last segment of the
source or under the name you give. ${SHELF_VARIABLE} moves the Shelf for one
run; firstmate shelf <directory> moves it for good, and that directory has to
be there already.

The window works out which distribution holds the Host and where the Host keeps
its home directory. Say them yourself with --distribution <name> and
--home <path> when it cannot.

A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path. A Grant is one way:
granting <from> the right to call <to> does not let <to> call <from>.

The Registry is read when the Host starts, so restart the Host to pick up a
change: systemctl --user restart firstmate`;

/** What the operator did wrong, as against what went wrong. */
const USAGE_FAULT = 2;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const config = readConfig();
  const home = config.home;

  switch (command) {
    case 'start':
      return start(rest);
    case 'desktop':
      return desktop(rest);
    case 'add':
      return add(home, rest);
    case 'remove':
      return remove(home, rest);
    case 'list':
      return list(home, rest);
    case 'grant':
      return grant(home, rest);
    case 'revoke':
      return revoke(home, rest);
    case 'shelf':
      return shelf(config, rest);
    case 'install':
      return install(config, rest);
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
async function start(argv: readonly string[]): Promise<number> {
  if (argv.length > 0) {
    console.error(`firstmate: start takes nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  await import('./main.ts');
  // The Host is listening and owns the process now. It ends on a signal, and
  // reports its own fault if it could not start at all.
  return 0;
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
    console.error(
      `firstmate: ${name} is not a Plugin Name. Use lower-case letters, digits and hyphens.`,
    );
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

  writeRegistry(home, left);
  // The directory itself is untouched. The Host stops serving and running it.
  console.log(`firstmate: removed ${name}`);
  console.log('firstmate: restart the Host to pick it up. The directory is untouched.');
  return 0;
}

function grant(home: string, argv: readonly string[]): number {
  const [from, to] = argv;
  if (from === undefined || to === undefined || argv.length > 2) {
    console.error(`firstmate: grant takes two Plugin Names: <from> <to>.\n\n${USAGE}`);
    return USAGE_FAULT;
  }

  const rows = readRegistry(home);
  const pair = findPair(rows, from, to);
  if (pair === undefined) return 1;
  const { fromRow, fromIndex } = pair;

  if (fromRow.grants.includes(to)) {
    console.log(`firstmate: ${from} can already call ${to}'s tools.`);
    return 0;
  }

  const rewritten = rows.slice();
  rewritten[fromIndex] = { ...fromRow, grants: [...fromRow.grants, to] };
  writeRegistry(home, rewritten);
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

  const rows = readRegistry(home);
  const pair = findPair(rows, from, to);
  if (pair === undefined) return 1;
  const { fromRow, fromIndex } = pair;

  if (!fromRow.grants.includes(to)) {
    console.log(`firstmate: ${from} was never granted the right to call ${to}'s tools.`);
    return 0;
  }

  const rewritten = rows.slice();
  rewritten[fromIndex] = {
    ...fromRow,
    grants: fromRow.grants.filter((name) => name !== to),
  };
  writeRegistry(home, rewritten);
  console.log(`firstmate: took back ${from}'s right to call ${to}'s tools.`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/**
 * Both Plugin Names of a Grant, checked and resolved against the Registry. A
 * Grant that named a Plugin that does not exist would be a Grant the operator
 * misreads later, so both commands refuse before they write anything.
 */
function findPair(
  rows: readonly PluginRow[],
  from: string,
  to: string,
): { readonly fromRow: PluginRow; readonly fromIndex: number } | undefined {
  for (const name of [from, to]) {
    if (!isPluginName(name)) {
      console.error(
        `firstmate: ${name} is not a Plugin Name. Use lower-case letters, digits and hyphens.`,
      );
      return undefined;
    }
  }
  const fromRow = rows.find((row) => row.name === from);
  if (fromRow === undefined) {
    console.error(`firstmate: no Plugin named ${from} is registered.`);
    return undefined;
  }
  if (!rows.some((row) => row.name === to)) {
    console.error(`firstmate: no Plugin named ${to} is registered.`);
    return undefined;
  }
  return { fromRow, fromIndex: rows.indexOf(fromRow) };
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

  // Checked before it is remembered, and what is remembered is the real path.
  const chosen = checkShelf(directory, config.home);
  writeSettings(config.home, { shelf: chosen });
  console.log(`firstmate: the Shelf is now ${chosen}`);

  const forced = shelfInEnvironment();
  if (forced !== undefined && forced !== chosen) {
    console.log(`firstmate: ${SHELF_VARIABLE} is set to ${forced}, and wins until it is unset.`);
  }
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/**
 * Fetch a Plugin into the Shelf and register it, in one step.
 *
 * It follows `add` step for step once the files have landed, because a Plugin
 * that was fetched is a Plugin like any other. Nothing the Plugin ships runs
 * here: its executable runs later, when the Host starts it.
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

  const name = given ?? nameOf(source);
  if (!isPluginName(name)) {
    if (given === undefined) {
      console.error(
        `firstmate: ${source} does not name a Plugin. Give the name yourself: ` +
          `firstmate install ${source} <name>`,
      );
      return 1;
    }
    console.error(
      `firstmate: ${name} is not a Plugin Name. Use lower-case letters, digits and hyphens.`,
    );
    return 1;
  }
  if (!isAbsolute(source)) {
    console.error(`firstmate: ${source} is not an absolute path.`);
    return 1;
  }
  const found = statSync(source, { throwIfNoEntry: false });
  if (found === undefined || !found.isDirectory()) {
    console.error(`firstmate: ${source} is not a directory.`);
    return 1;
  }

  // Refused before anything is fetched, so a refusal costs no copying and a
  // Plugin that is running is never replaced under it.
  const rows = readRegistry(config.home);
  const taken = rows.find((row) => row.name === name);
  if (taken !== undefined) {
    console.error(`firstmate: ${name} is already registered, at ${taken.directory}.`);
    return 1;
  }

  // The default Shelf is inside the Host's home directory, which the Host
  // makes for itself, so install works before anything has been chosen. A
  // Shelf the operator named is theirs to make, so that a typo is refused
  // rather than created.
  if (config.shelf === defaultShelf(config.home)) {
    mkdirSync(config.shelf, { recursive: true, mode: 0o700 });
  }
  // Checked on every run. The remembered Shelf is never trusted as already
  // checked, because a path that was a directory yesterday can be a symlink
  // today.
  const shelf = checkShelf(config.shelf, config.home);
  const directory = await fetchPlugin(source, shelf, name);

  writeRegistry(config.home, [...rows, { name, directory, grants: [] }]);
  console.log(`firstmate: installed ${name} at ${directory}`);
  console.log('firstmate: restart the Host to pick it up.');
  return 0;
}

/** The Plugin Name a source suggests: its last segment. */
function nameOf(source: string): string {
  return basename(source.replace(/[/\\]+$/, ''));
}

function list(home: string, argv: readonly string[]): number {
  if (argv.length > 0) {
    console.error(`firstmate: list takes nothing.\n\n${USAGE}`);
    return USAGE_FAULT;
  }
  // An empty Registry says nothing, as an empty directory listing says nothing.
  for (const row of readRegistry(home)) console.log(describe(row));
  return 0;
}

function describe(row: PluginRow): string {
  const grants = row.grants.length === 0 ? '' : `  grants: ${row.grants.join(', ')}`;
  return `${row.name}\t${row.directory}${grants}`;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (fault: unknown) {
  console.error(`firstmate: ${fault instanceof Error ? fault.message : String(fault)}`);
  process.exitCode = 1;
}
