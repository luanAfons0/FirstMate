/**
 * The fake Windows programs `tests/helpers/windows.ts` puts on a machine:
 * `cmd.exe`, `wslpath`, `reg.exe`, the App's installer and the App itself.
 *
 * One program plays every part. On Linux each fake is a shell script that
 * runs this file with the part's name. On Windows a fake has to be a real
 * program, so each is a copy of Node, named for its part, and this file is
 * loaded into it by NODE_OPTIONS before Node looks for a script: it plays the
 * part its own name says, and ends. In any other Node, the command line's
 * own among them, it does nothing.
 *
 * Each part writes what it was asked to `calls.log`, one line each, and keeps
 * what it knows in the machine's folder, named by FAKE_WINDOWS. The registry
 * is `registry.json` there. On Linux a Windows path `C:\…` is the folder
 * `c/…` there; on Windows a path is itself.
 */
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** What the helper tells every fake about the machine, in `machine.json`. */
export type Machine = {
  /** The App's registry keys, named by the GUID its installer is built with. */
  readonly uninstallKey: string;
  readonly installKey: string;
  /** Windows' temp folder, as Windows names it. */
  readonly temp: string;
  /** The folder the installer puts the App in, as Windows names it. */
  readonly installTo: string;
};

/** The registry: each key's values, by name. */
type Registry = Record<string, Record<string, string>>;

/** This file, which every fake on Linux runs. */
export const FAKE = resolve(import.meta.dirname, 'windows-fake.ts');

/** A Windows path, as this machine reaches it. */
export function here(root: string, path: string): string {
  if (process.platform === 'win32') return path;
  return join(root, path.slice(0, 1).toLowerCase(), ...path.slice(3).split('\\'));
}

/** A fake program at this path, playing the part its name says. */
export function writeFake(path: string): void {
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, path);
    return;
  }
  const name = basename(path);
  writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' '${name}' "$@"\n`, {
    mode: 0o755,
  });
}

/** Install the App of this version, as its installer would: the program and two keys. */
export function install(root: string, machine: Machine, version: string): void {
  const folder = here(root, machine.installTo);
  mkdirSync(folder, { recursive: true });
  writeFake(join(folder, 'FirstMate.exe'));
  const registry = readRegistry(root);
  registry[machine.uninstallKey] = { DisplayName: `FirstMate ${version}`, DisplayVersion: version };
  registry[machine.installKey] = { InstallLocation: machine.installTo };
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry, null, 2));
}

function readRegistry(root: string): Registry {
  try {
    return JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')) as Registry;
  } catch {
    return {};
  }
}

/** The part this process plays, and the words it was given, or nothing. */
function part(): readonly [string, readonly string[]] | undefined {
  if (process.platform !== 'win32') {
    const [name = '', ...words] = process.argv.slice(2);
    return [name, words];
  }
  const name = basename(process.execPath);
  if (name.toLowerCase() === 'node.exe') return undefined;
  // Node takes the first word for a script and resolves it to a path before
  // this runs, so `/S` arrives as `C:\S`. The word is read back from that.
  const [first, ...rest] = process.argv.slice(1);
  if (first === undefined) return [name, []];
  const word = basename(first);
  const typed = first === resolve(`/${word}`) ? `/${word}` : first === resolve(word) ? word : first;
  return [name, [typed, ...rest]];
}

/** A registry file as `reg.exe export` writes one: UTF-16, with its mark. */
function exported(key: string, values: Record<string, string>): Buffer {
  const lines = Object.entries(values).map(
    ([name, value]) => `"${name}"="${value.replace(/[\\"]/g, (found) => `\\${found}`)}"`,
  );
  const full = key.replace(/^HKCU\\/, 'HKEY_CURRENT_USER\\');
  const text = ['Windows Registry Editor Version 5.00', '', `[${full}]`, ...lines, '', ''];
  return Buffer.from(`\uFEFF${text.join('\r\n')}`, 'utf16le');
}

/** Play one part, and give back the code it ends with. */
function play(root: string, name: string, words: readonly string[]): number {
  appendFileSync(join(root, 'calls.log'), `${[name, ...words].join(' ')}\n`);
  const machine = JSON.parse(readFileSync(join(root, 'machine.json'), 'utf8')) as Machine;

  if (name === 'cmd.exe') {
    if (words.join(' ') !== '/d /u /c echo %TEMP%') return 1;
    process.stdout.write(Buffer.from(`${machine.temp}\r\n`, 'utf16le'));
    return 0;
  }
  if (name === 'wslpath') {
    const [flag, path = ''] = words;
    if (flag !== '-u') return 1;
    process.stdout.write(`${here(root, path)}\n`);
    return 0;
  }
  if (name === 'reg.exe') {
    const [verb, key = '', file = ''] = words;
    const values = readRegistry(root)[key];
    if (verb !== 'export' || values === undefined) {
      process.stderr.write('ERROR: The system was unable to find the specified registry key.\r\n');
      return 1;
    }
    writeFileSync(here(root, file), exported(key, values));
    return 0;
  }
  const installer = /^FirstMate-Setup-(.+)\.exe$/.exec(name);
  if (installer !== null) {
    install(root, machine, installer[1] ?? '');
    return 0;
  }
  // The App. That it was opened, in calls.log, is all a test sees of it.
  return name === 'FirstMate.exe' ? 0 : 1;
}

const root = process.env['FAKE_WINDOWS'];
const playing = root === undefined ? undefined : part();
if (root !== undefined && playing !== undefined) {
  const [name, words] = playing;
  process.exit(play(root, name, words));
}
