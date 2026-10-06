/**
 * The settings file: the settings FirstMate remembers.
 *
 * The Host stores a Registry and nothing else, and it keeps no run history, no
 * logs and no settings store of its own. Five settings are the exception: the
 * Shelf, because nothing can fetch a Plugin without somewhere to put it
 * (ADR-0012), the Places, because a Plugin has to run somewhere (ADR-0021),
 * the Shortcuts, because the Tray has to learn them from somewhere that
 * survives a restart (ADR-0013), the Plugin Order, because the Registry is
 * read only when the Host starts and a new order should not restart every
 * Plugin Server (ADR-0016), and the operator's answers when a Plugin Page asks
 * for the microphone or a capture of the screen. The first four are written
 * from a terminal and from nowhere else. The answers are written by the App's
 * main process, after the operator answers its own dialog, and never by a
 * page (ADR-0012).
 *
 * It is written the way the runtime file is written: whole, through a rename,
 * for this user alone. A settings file that is not there means nothing has
 * been chosen yet; a settings file that cannot be read is an error the
 * operator must see, as a damaged Registry is.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlaces, type Place } from './places.ts';
import { isPluginName } from './registry.ts';
import { isPluginPath, normalKeys, type Shortcut } from './shortcut.ts';

/** The settings file, inside the Host's home directory. */
const SETTINGS_FILE = 'settings.json';

/** What the settings file holds. */
export type Settings = {
  /** The default Place's Shelf, as the operator chose it, absent until one is chosen. */
  readonly shelf?: string;
  /** The Places the operator added, absent until one is added. */
  readonly places?: readonly Place[];
  /** The Shortcuts the operator bound, absent until one is bound. */
  readonly shortcuts?: readonly Shortcut[];
  /** The Plugin Order the operator chose, absent until one is chosen. */
  readonly order?: readonly string[];
  /** What the operator answered each Plugin that asked for a device, by Plugin Name. */
  readonly permissions?: Readonly<Record<string, PermissionAnswers>>;
};

/**
 * What the operator answered one Plugin: true to allow, false to refuse, and
 * absent until the Plugin first asks.
 */
export type PermissionAnswers = {
  /** Whether its Plugin Page may use the microphone. */
  readonly microphone?: boolean;
  /** Whether its Plugin Page may capture the screen or a window, with their sound. */
  readonly capture?: boolean;
};

/** The devices a Plugin Page may ask for. Every other permission is refused unasked. */
const DEVICES: readonly (keyof PermissionAnswers)[] = ['microphone', 'capture'];

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
  const places = record['places'];
  const shortcuts = record['shortcuts'];
  const order = record['order'];
  const permissions = record['permissions'];
  return {
    ...(shelf === undefined ? {} : { shelf }),
    ...(places === undefined ? {} : { places: parsePlaces(places, path) }),
    ...(shortcuts === undefined ? {} : { shortcuts: parseShortcuts(shortcuts, path) }),
    ...(order === undefined ? {} : { order: parseOrder(order, path) }),
    ...(permissions === undefined ? {} : { permissions: parsePermissions(permissions, path) }),
  };
}

/**
 * The permission answers, checked. A damaged one fails every command, as a
 * damaged Shortcut does: an answer read wrongly could let a Plugin Page reach
 * a device the operator refused.
 */
function parsePermissions(value: unknown, path: string): Record<string, PermissionAnswers> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The settings at ${path} need "permissions" to be a JSON object.`);
  }
  const answers: Record<string, PermissionAnswers> = {};
  for (const [plugin, given] of Object.entries(value)) {
    const where = `The permissions of ${JSON.stringify(plugin)} in the settings at ${path}`;
    if (!isPluginName(plugin)) {
      throw new Error(`${where} need to be kept under a Plugin Name.`);
    }
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
      throw new Error(`${where} need to be a JSON object.`);
    }
    for (const [device, answer] of Object.entries(given)) {
      if (!DEVICES.includes(device as keyof PermissionAnswers) || typeof answer !== 'boolean') {
        throw new Error(
          `${where} may hold only ${DEVICES.map((one) => `"${one}"`).join(' and ')}, each ` +
            `true or false, and not ${JSON.stringify(device)}: ${JSON.stringify(answer)}.`,
        );
      }
    }
    answers[plugin] = given as PermissionAnswers;
  }
  return answers;
}

/**
 * The Plugin Order, checked. A name the Registry does not hold is kept here
 * and ignored where the order is used, so that a file edited by hand does not
 * stop the Host. A name held twice is damage, and fails every command.
 */
function parseOrder(value: unknown, path: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((name) => typeof name !== 'string' || !isPluginName(name))
  ) {
    throw new Error(`The settings at ${path} need "order" to be an array of Plugin Names.`);
  }
  const seen = new Set<string>();
  for (const name of value as string[]) {
    if (seen.has(name)) {
      throw new Error(`The settings at ${path} name ${name} twice in "order".`);
    }
    seen.add(name);
  }
  return value as string[];
}

/**
 * Every Plugin in the Plugin Order. The Plugins the order names come first,
 * in that order; every other Plugin follows, in Registry order; and a name
 * the Registry does not hold is passed over. With no order chosen, this is
 * the Registry order.
 */
export function inPluginOrder<T extends { readonly name: string }>(
  plugins: readonly T[],
  order: readonly string[],
): T[] {
  const named = order.flatMap((name) => plugins.filter((plugin) => plugin.name === name));
  return [...named, ...plugins.filter((plugin) => !order.includes(plugin.name))];
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
