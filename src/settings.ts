/**
 * The settings file: the two settings the Host remembers.
 *
 * The Host stores a Registry and nothing else, and it keeps no run history, no
 * logs and no settings store of its own. Two settings are the exception: the
 * Shelf, because nothing can fetch a Plugin without somewhere to put it
 * (ADR-0012), and the Shortcuts, because the Tray has to learn them from
 * somewhere that survives a restart (ADR-0013). Both are written from a
 * terminal and from nowhere else.
 *
 * It is written the way the runtime file is written: whole, through a rename,
 * for this user alone. A settings file that is not there means nothing has
 * been chosen yet; a settings file that cannot be read is an error the
 * operator must see, as a damaged Registry is.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPluginName } from './registry.ts';
import { isPluginPath, normalKeys, type Shortcut } from './shortcut.ts';

/** The settings file, inside the Host's home directory. */
const SETTINGS_FILE = 'settings.json';

/** What the settings file holds. */
export type Settings = {
  /** The Shelf the operator chose, absent until one is chosen. */
  readonly shelf?: string;
  /** The Shortcuts the operator bound, absent until one is bound. */
  readonly shortcuts?: readonly Shortcut[];
};

function settingsPath(home: string): string {
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
 * before it. A caller that changes one setting reads the others first and
 * hands them back, because nothing here merges.
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
  const record = parsed as Record<string, unknown>;
  const shelf = record['shelf'];
  if (shelf !== undefined && typeof shelf !== 'string') {
    throw new Error(`The settings at ${path} need "shelf" to be a path.`);
  }
  const shortcuts = record['shortcuts'];
  return {
    ...(shelf === undefined ? {} : { shelf }),
    ...(shortcuts === undefined ? {} : { shortcuts: parseShortcuts(shortcuts, path) }),
  };
}

/**
 * The Shortcuts, each checked as `bind` checks it. A damaged one fails every
 * command, as a damaged Shelf does, rather than being dropped in silence.
 */
function parseShortcuts(value: unknown, path: string): Shortcut[] {
  if (!Array.isArray(value)) {
    throw new Error(`The settings at ${path} need "shortcuts" to be an array.`);
  }
  const shortcuts = value.map((item: unknown, at): Shortcut => {
    const where = `The Shortcut at position ${at} in the settings at ${path}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${where} needs to be a JSON object.`);
    }
    const { keys, plugin, path: under } = item as Record<string, unknown>;
    if (typeof keys !== 'string' || normalKeys(keys) !== keys) {
      throw new Error(`${where} needs "keys" in normal form, such as "Ctrl+Alt+N".`);
    }
    if (typeof plugin !== 'string' || !isPluginName(plugin)) {
      throw new Error(`${where} needs "plugin" to be a Plugin Name.`);
    }
    if (typeof under !== 'string' || !isPluginPath(under, plugin)) {
      throw new Error(`${where} needs "path" to be a relative path inside its Plugin.`);
    }
    return { keys, plugin, path: under };
  });
  const seen = new Set<string>();
  for (const { keys } of shortcuts) {
    if (seen.has(keys)) {
      throw new Error(`The settings at ${path} bind ${keys} twice.`);
    }
    seen.add(keys);
  }
  return shortcuts;
}
