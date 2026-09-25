/**
 * The Shelf: the directory a fetched Plugin lands in.
 *
 * The operator chooses it, the Host remembers it, and nothing ever scans it.
 * It resolves in three steps — the environment variable, then the settings
 * file, then a directory under the Host's home — because the environment is
 * the seam this whole project tests through (ADR-0012).
 *
 * One check serves every command, so a path refused in one place is refused
 * everywhere in the same words. The check that matters is the last one:
 * absoluteness and resolution are lexical, so a symlink pointing at the Host's
 * home directory passes every lexical rule and still *is* the home directory.
 * Both sides are taken to their real paths before they are compared, because
 * the home directory is not resolved anywhere else either; resolving one side
 * alone would compare a real path against a path that is not one.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { readSettings } from './settings.ts';

/** The environment variable that moves the Shelf. */
export const SHELF_VARIABLE = 'FIRSTMATE_SHELF';

/** The Shelf's directory inside the Host's home, until the operator moves it. */
const SHELF_DIRECTORY = 'shelf';

/**
 * The longest a Shelf may be, counted in bytes rather than in characters,
 * because bytes are what a filesystem counts.
 */
const PATH_LIMIT = 4096;

/** Where the Shelf is when nobody has chosen one. */
export function defaultShelf(home: string): string {
  return join(home, SHELF_DIRECTORY);
}

/** The Shelf the environment names, if it names one. */
export function shelfInEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const given = env[SHELF_VARIABLE];
  return given === undefined || given === '' ? undefined : resolve(given);
}

/**
 * The Shelf in force. The environment wins, then the settings file, then the
 * default. Nothing here touches the Shelf itself: what is reported is what was
 * chosen, and a command that writes into the Shelf checks it again on every
 * run, because a path that was a directory yesterday can be a symlink today.
 */
export function readShelf(home: string, env: NodeJS.ProcessEnv = process.env): string {
  return shelfInEnvironment(env) ?? readSettings(home).shelf ?? defaultShelf(home);
}

/**
 * The Shelf this path names, or a refusal saying why it names none. What comes
 * back is the real path, never the path as it was written, so what the
 * operator reads back is what FirstMate will use.
 *
 * Every lexical check runs before the first filesystem call, so a nonsense
 * path is refused without touching a disk.
 */
export function checkShelf(given: string, home: string): string {
  const wanted = lexical(given);

  let real: string;
  try {
    real = realpathSync(wanted);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${wanted} does not exist. Create it, then set it as the Shelf.`, {
        cause,
      });
    }
    throw new Error(`${wanted} cannot be reached.`, { cause });
  }
  if (!statSync(real).isDirectory()) {
    throw new Error(`${real} is a file, not a directory.`);
  }

  // A Shelf that is, or holds, the home directory is a Shelf that writes a
  // fetched Plugin over the Registry and the runtime file.
  const realHome = realPathOf(resolve(home));
  const belongings = 'where the Registry and the runtime file live';
  if (real === realHome) {
    throw new Error(`${real} is the Host's own home directory, ${belongings}.`);
  }
  if (holds(real, realHome)) {
    throw new Error(`${real} holds the Host's own home directory, ${belongings}.`);
  }

  // Advice, not a guarantee: a directory writable now can be read-only later.
  // Saying so now beats saying it in the middle of the next install.
  try {
    accessSync(real, constants.W_OK | constants.X_OK);
  } catch (cause) {
    throw new Error(`${real} cannot be written to by this user.`, { cause });
  }
  return real;
}

/** Everything that can be decided from the path itself, in order. */
function lexical(given: string): string {
  const trimmed = given.trim();
  if (trimmed === '') {
    throw new Error('A Shelf is a directory, and none was given.');
  }
  if (Buffer.byteLength(trimmed) > PATH_LIMIT) {
    throw new Error(`A Shelf is ${PATH_LIMIT} bytes at most, and that path is longer.`);
  }
  if (/\p{Cc}/u.test(trimmed)) {
    throw new Error('A Shelf may not hold a control character.');
  }
  const inside = wslPathOf(trimmed);
  if (inside !== undefined) {
    throw new Error(`${trimmed} is a Windows path. Inside WSL it is ${inside}.`);
  }
  if (!isAbsolute(trimmed)) {
    throw new Error(`${trimmed} is not an absolute path.`);
  }
  return resolve(trimmed);
}

/**
 * The WSL path a Windows path names, or nothing when the path is not one. The
 * window runs on Windows, so a path pasted from it is a Windows path, and
 * naming the path it is here is more use than refusing it flatly (ADR-0007).
 */
function wslPathOf(given: string): string | undefined {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(given);
  if (drive !== null) {
    const letter = (drive[1] ?? '').toLowerCase();
    return `/mnt/${letter}/${(drive[2] ?? '').replaceAll('\\', '/')}`;
  }
  // \\wsl.localhost\Debian\home\me is how Windows spells a path that is
  // already inside this machine.
  const unc = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/.exec(given);
  if (unc !== null) {
    const rest = (unc[1] ?? '').replaceAll('\\', '/');
    return rest === '' ? '/' : rest;
  }
  return undefined;
}

/** Whether the outer directory holds the inner one, by path and not by name. */
function holds(outer: string, inner: string): boolean {
  const prefix = outer.endsWith(sep) ? outer : `${outer}${sep}`;
  return inner.startsWith(prefix);
}

/** The real path, or the path itself where there is nothing there to resolve. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
