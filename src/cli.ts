#!/usr/bin/env node
/**
 * FirstMate from a terminal: run the Host, and keep the Registry it reads.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node src/cli.ts start
 *   node src/cli.ts add <name> <directory>
 *   node src/cli.ts remove <name>
 *   node src/cli.ts list
 *   node src/cli.ts grant <from> <to>
 *   node src/cli.ts revoke <from> <to>
 */
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readConfig } from './config.ts';
import {
  isPluginName,
  readRegistry,
  registryPath,
  writeRegistry,
  type PluginRow,
} from './registry.ts';

const USAGE = `usage:
  firstmate start                    run the Host until it is stopped.
  firstmate add <name> <directory>   register a Plugin. The directory is not copied.
  firstmate remove <name>            take a Plugin out of the Registry.
  firstmate list                     every Plugin in the Registry.
  firstmate grant <from> <to>        let <from> call <to>'s tools.
  firstmate revoke <from> <to>       take that Grant back.

A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path. A Grant is one way:
granting <from> the right to call <to> does not let <to> call <from>.

The Registry is read when the Host starts, so restart the Host to pick up a
change: systemctl --user restart firstmate`;

/** What the operator did wrong, as against what went wrong. */
const USAGE_FAULT = 2;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const home = readConfig().home;

  switch (command) {
    case 'start':
      return start(rest);
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
