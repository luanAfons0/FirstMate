#!/usr/bin/env node
/**
 * The Registry from a terminal: add a Plugin, remove one, list them.
 *
 * Adding a Plugin neither copies nor symlinks its directory. The Registry
 * holds the path and nothing else, so a Plugin stays in its own repository
 * wherever it already lives.
 *
 *   node src/cli.ts add <name> <directory>
 *   node src/cli.ts remove <name>
 *   node src/cli.ts list
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
  firstmate add <name> <directory>   register a Plugin. The directory is not copied.
  firstmate remove <name>            take a Plugin out of the Registry.
  firstmate list                     every Plugin in the Registry.

A Plugin Name is lower-case letters, digits and hyphens, because it names the
Plugin in every address. A directory is an absolute path.

The Registry is read when the Host starts, so restart the Host to pick up a
change: systemctl --user restart firstmate`;

/** What the operator did wrong, as against what went wrong. */
const USAGE_FAULT = 2;

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  const home = readConfig().home;

  switch (command) {
    case 'add':
      return add(home, rest);
    case 'remove':
      return remove(home, rest);
    case 'list':
      return list(home, rest);
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
  process.exitCode = main(process.argv.slice(2));
} catch (fault: unknown) {
  console.error(`firstmate: ${fault instanceof Error ? fault.message : String(fault)}`);
  process.exitCode = 1;
}
