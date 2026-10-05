/**
 * Whether FirstMate starts at logon.
 *
 * Windows runs whatever sits in the Startup folder when a person logs in, so
 * the toggle is one file: it is there, or it is not. Nothing is written to the
 * registry, nothing is scheduled, and turning it off deletes exactly what
 * turning it on wrote.
 *
 * The file is a script rather than a shortcut because the program is a console
 * program, and a console program started at logon flashes a window. A shortcut
 * cannot hide that; the script host can, and it is what FirstMate already uses
 * for the same reason.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What FirstMate calls its own entry, so that it removes only its own. */
const ENTRY = 'FirstMate.vbs';

export type Logon = {
  /** The absolute path of the entry, whether or not it is there. */
  readonly path: string;
  /** Whether FirstMate starts at logon now. */
  readonly on: boolean;
};

/** Where Windows keeps what it runs at logon. */
function startupFolder(env: NodeJS.ProcessEnv): string {
  const roaming = env['APPDATA'];
  const under =
    roaming === undefined || roaming === '' ? join(homedir(), 'AppData', 'Roaming') : roaming;
  return join(under, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

/** Whether FirstMate starts at logon, and where that is written down. */
export function readLogon(env: NodeJS.ProcessEnv): Logon {
  const path = join(startupFolder(env), ENTRY);
  return { path, on: exists(path) };
}

/**
 * Turn starting at logon on or off.
 *
 * Returns nothing when it worked, and a sentence a person can act on when it
 * did not: a Startup folder that cannot be written to is worth saying out loud.
 */
export function setLogon(
  env: NodeJS.ProcessEnv,
  on: boolean,
  command: readonly string[],
): string | undefined {
  const { path } = readLogon(env);
  try {
    if (!on) {
      rmSync(path, { force: true });
      return undefined;
    }
    mkdirSync(startupFolder(env), { recursive: true });
    writeFileSync(path, entry(command), 'utf8');
    return undefined;
  } catch (fault: unknown) {
    const said = fault instanceof Error ? fault.message : String(fault);
    return `FirstMate could not change what runs at logon: ${said}`;
  }
}

/**
 * The entry itself: one line that starts the command with no window at all.
 *
 * Every part of the command is quoted here and nowhere else, because this is
 * the one place a list of arguments has to become a line of text. A value that
 * carries a quote of its own is escaped rather than trusted (#45).
 */
function entry(command: readonly string[]): string {
  const line = command.map(quoted).join(' ');
  return `' FirstMate starts at logon. This file is what makes that true.
'
' It was written by FirstMate itself, from its menu, and turning start at logon
' off deletes it again. Deleting it by hand does the same thing.
'
' The window style 0 is the whole point: the program is a console program, and
' without this a console would flash on every logon.

Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run ${vbsString(line)}, 0, False
`;
}

/**
 * One argument of a Windows command line, quoted the way Windows reads it.
 *
 * Inside quotes, a run of backslashes is literal unless a quote follows it, so
 * the run before an escaped quote, and the run before the closing quote, is
 * written twice. Without that, a path that ends in a backslash swallows the
 * closing quote and the next argument with it. An empty argument is written as
 * two quotes, or it is no argument at all.
 */
function quoted(argument: string): string {
  if (argument !== '' && !/[\s"]/.test(argument)) return argument;
  const inside = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${inside}"`;
}

/** One VBScript string literal. A quote inside it is written twice. */
function vbsString(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/** Whether a file is at this path. */
function exists(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}
