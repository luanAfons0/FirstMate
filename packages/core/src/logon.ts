/**
 * How the App starts at logon: one entry for each system, which starts the
 * App with one argument (ADR-0026).
 *
 * On Windows it is the value FirstMate in the user's Run key. On Linux it is
 * an XDG autostart desktop entry, `firstmate.desktop`, in the user's config
 * directory. The App sets it from the Tray and the Settings View, and `setup`
 * sets it from a terminal, so both write the same entry and each sees what
 * the other wrote (ADR-0024). It is off until the operator turns it on.
 *
 * The Windows entry is written by Electron and by reg.exe, so this module
 * holds only its names. The Linux entry is a plain file, so this module reads
 * and writes it for the App and the terminal alike.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/** The Run key every logon entry of this user is a value of. */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** The name of the App's logon entry. */
export const LOGON_NAME = 'FirstMate';

/** The argument the logon entry starts the App with, so it begins in the Tray. */
export const AT_LOGON = '--at-logon';

/** The name of the App's autostart entry on Linux. */
const AUTOSTART_NAME = 'firstmate.desktop';

/**
 * Where the App's autostart entry is on Linux: in `autostart` under
 * XDG_CONFIG_HOME, or under `~/.config` when that is unset. The XDG spec
 * says a relative XDG_CONFIG_HOME is ignored, so it is.
 */
function autostartFile(env: NodeJS.ProcessEnv = process.env): string {
  const config = env['XDG_CONFIG_HOME'] ?? '';
  const root = isAbsolute(config) ? config : join(homedir(), '.config');
  return join(root, 'autostart', AUTOSTART_NAME);
}

/**
 * Whether the App starts at logon on Linux: whether its autostart entry is
 * there and not hidden. A desktop that turns an entry off writes one of two
 * keys into it, and both are read as off.
 */
export function readAutostart(env: NodeJS.ProcessEnv = process.env): boolean {
  let text: string;
  try {
    text = readFileSync(autostartFile(env), 'utf8');
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw fault;
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return !lines.includes('Hidden=true') && !lines.includes('X-GNOME-Autostart-enabled=false');
}

/**
 * Turn start at logon on Linux on, with an entry that starts `program` with
 * `--at-logon`, or off, by removing the entry. The entry is written whole
 * through a rename, so a desktop never reads half of one.
 */
export function writeAutostart(
  on: boolean,
  program: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = autostartFile(env);
  if (!on) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, autostartEntry(program));
  renameSync(temporary, file);
}

/** The autostart entry that starts `program` with `--at-logon`. */
function autostartEntry(program: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=FirstMate',
    'Comment=Start FirstMate in the Tray',
    `Exec=${execQuoted(program)} ${AT_LOGON}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/**
 * A program path as an Exec key holds it. The desktop entry spec quotes an
 * argument in double quotes with `"`, `` ` ``, `$` and `\` escaped, then
 * escapes every `\` of the value once more, and writes `%` as `%%`.
 */
function execQuoted(program: string): string {
  if (/[\n\r]/.test(program)) {
    throw new Error(`The App's path ${JSON.stringify(program)} holds a line break.`);
  }
  const argument = `"${program.replace(/["`$\\]/g, '\\$&')}"`;
  return argument.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}
