/**
 * The settings file: the one setting the Host remembers.
 *
 * The Host stores a Registry and nothing else, and it keeps no run history, no
 * logs and no settings store of its own. One setting is the exception, the
 * Shelf, because nothing can fetch a Plugin without somewhere to put it
 * (ADR-0012).
 *
 * It is written the way the runtime file is written: whole, through a rename,
 * for this user alone. A settings file that is not there means nothing has
 * been chosen yet; a settings file that cannot be read is an error the
 * operator must see, as a damaged Registry is.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The settings file, inside the Host's home directory. */
export const SETTINGS_FILE = 'settings.json';

export type Settings = {
  /** The Shelf the operator chose, absent until one is chosen. */
  readonly shelf?: string;
};

export function settingsPath(home: string): string {
  return join(home, SETTINGS_FILE);
}

/**
 * What the operator has chosen. Nothing chosen is not an error: a FirstMate
 * that has never been configured is a FirstMate with every default in force.
 */
export function readSettings(home: string): Settings {
  const path = settingsPath(home);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read the settings at ${path}.`, { cause });
  }
  return parseSettings(text, path);
}

/**
 * Replace the settings with these. They are written whole and moved into
 * place, so a Host reading them always sees one settings file or the one
 * before it.
 */
export function writeSettings(home: string, settings: Settings): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = settingsPath(home);
  const pending = `${path}.pending`;
  writeFileSync(pending, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(pending, path);
}

function parseSettings(text: string, path: string): Settings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`The settings at ${path} are not valid JSON.`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The settings at ${path} need to be a JSON object.`);
  }
  const shelf = (parsed as Record<string, unknown>)['shelf'];
  if (shelf !== undefined && typeof shelf !== 'string') {
    throw new Error(`The settings at ${path} need "shelf" to be a path.`);
  }
  return shelf === undefined ? {} : { shelf };
}
