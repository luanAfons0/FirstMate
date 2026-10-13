/**
 * The settings file: the settings FirstMate remembers.
 *
 * The Host stores a Registry and nothing else, and it keeps no run history, no
 * logs and no settings store of its own. Six settings are the exception: the
 * Shelf, because nothing can fetch a Plugin without somewhere to put it
 * (ADR-0012), the Places, because a Plugin has to run somewhere (ADR-0021),
 * the Shortcuts, because the App has to learn them from somewhere that
 * survives a restart (ADR-0013), the Plugin Order, because the Registry is
 * read only when the Host starts and a new order should not restart every
 * Plugin Server (ADR-0016), the operator's answers when a Plugin Page asks
 * for the microphone or a capture of the screen, and the Mate settings, which
 * say how the Mate runs the operator's Agent (ADR-0031). The Shortcuts and the
 * Plugin Order are written from a terminal alone. The Shelf and the Places are
 * written from a terminal and from the App's Settings View, the answers by the
 * App's own dialog, and the Mate settings by the App's main process; all
 * through the App's main process or a terminal, never by a page (ADR-0012).
 *
 * It is written the way the runtime file is written: whole, through a rename,
 * for this user alone. A settings file that is not there means nothing has
 * been chosen yet; a settings file that cannot be read is an error the
 * operator must see, as a damaged Registry is.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { AGENT_NAMES, EFFORTS, isAgent, isModelName, type Agent } from './agent-run.ts';
import { allPlaces, parsePlaces, type Place } from './places.ts';
import { refuse } from './refusal.ts';
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
  /** How the Mate runs the operator's Agent, absent until one is chosen. */
  readonly mate?: MateSettings;
};

/**
 * How the Mate runs the operator's Agent. Each field but the Agent may be
 * absent or empty, and then the Agent's own default holds: its own model, its
 * own effort, the default Place, and its program found on PATH. No `mate` key
 * at all is Claude with every default.
 */
export type MateSettings = {
  readonly agent: Agent;
  /** The model the Agent answers with. */
  readonly model?: string;
  /** The effort, one of the Agent's own levels. */
  readonly effort?: string;
  /** The Place the Agent runs in, by name. */
  readonly place?: string;
  /** The absolute path of the Agent's program, for an Agent that is not on PATH. */
  readonly program?: string;
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
  const mate = record['mate'];
  const parsedPlaces = places === undefined ? undefined : parsePlaces(places, path);
  return {
    ...(shelf === undefined ? {} : { shelf }),
    ...(parsedPlaces === undefined ? {} : { places: parsedPlaces }),
    ...(shortcuts === undefined ? {} : { shortcuts: parseShortcuts(shortcuts, path) }),
    ...(order === undefined ? {} : { order: parseOrder(order, path) }),
    ...(permissions === undefined ? {} : { permissions: parsePermissions(permissions, path) }),
    ...(mate === undefined ? {} : { mate: parseMate(mate, path, allPlaces(parsedPlaces)) }),
  };
}

/** The fields the Mate settings may hold. */
const MATE_FIELDS: readonly (keyof MateSettings)[] = [
  'agent',
  'model',
  'effort',
  'place',
  'program',
];

/**
 * The Mate settings, checked. A damaged one fails every command, as a damaged
 * Shortcut does, so that a wrong Agent, or a word cmd.exe would read as its
 * own, is never run. A Place that is not among these is damage too: the Mate
 * would run in no Place at all, and `place remove` keeps it from happening.
 */
function parseMate(value: unknown, path: string, places: readonly Place[]): MateSettings {
  const fault = mateFault(value, path, places);
  if (fault !== undefined) throw new Error(fault.sentence);
  return value as MateSettings;
}

/**
 * Mate settings the Settings View asks to keep, checked as the settings file
 * is read, so a value refused here is refused in the sentence a terminal sees
 * once the file holds it. The refusal says which field it is about.
 */
export function checkMate(home: string, value: unknown): MateSettings {
  const settings = readSettings(home);
  const fault = mateFault(value, settingsPath(home), allPlaces(settings.places));
  if (fault !== undefined) throw refuse('invalid', fault.sentence, { about: fault.field });
  return value as MateSettings;
}

/** What is wrong with Mate settings, and which field it is in; nothing when they are whole. */
function mateFault(
  value: unknown,
  path: string,
  places: readonly Place[],
): { readonly field?: string; readonly sentence: string } | undefined {
  const where = `The Mate settings in the settings at ${path}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { sentence: `${where} need to be a JSON object.` };
  }
  const record = value as Record<string, unknown>;
  for (const [field, given] of Object.entries(record)) {
    if (!MATE_FIELDS.includes(field as keyof MateSettings)) {
      return {
        sentence:
          `${where} may hold only ${MATE_FIELDS.map((one) => `"${one}"`).join(', ')}, ` +
          `and not ${JSON.stringify(field)}.`,
      };
    }
    if (field !== 'agent' && typeof given !== 'string') {
      return {
        field,
        sentence: `${where} need "${field}" to be a string, and not ${JSON.stringify(given)}.`,
      };
    }
  }
  const { agent, model, effort, place, program } = record;
  if (!isAgent(agent)) {
    return {
      field: 'agent',
      sentence: `${where} need "agent" to be "claude" or "codex", and not ${JSON.stringify(agent)}.`,
    };
  }
  if (typeof model === 'string' && model !== '' && !isModelName(model)) {
    return {
      field: 'model',
      sentence:
        `${where} need "model" to be a model name of letters, digits and . _ - : / @ [ ], ` +
        `and not ${JSON.stringify(model)}.`,
    };
  }
  const efforts = EFFORTS[agent];
  if (typeof effort === 'string' && effort !== '' && !efforts.includes(effort)) {
    return {
      field: 'effort',
      sentence:
        `${where} need "effort" to be one of ${efforts.join(', ')} for ${AGENT_NAMES[agent]}, ` +
        `or empty, and not ${JSON.stringify(effort)}.`,
    };
  }
  if (typeof program === 'string' && program !== '' && !isAbsolute(program)) {
    return {
      field: 'program',
      sentence: `${where} need "program" to be an absolute path, and not ${JSON.stringify(program)}.`,
    };
  }
  const names = places.map((one) => one.name);
  if (typeof place === 'string' && place !== '' && !names.includes(place)) {
    return {
      field: 'place',
      sentence:
        `${where} need "place" to name a Place, one of ${names.join(', ')}, ` +
        `and not ${JSON.stringify(place)}.`,
    };
  }
  return undefined;
}

/**
 * One Mate setting as the Mate uses it: the value given, or nothing when it is
 * absent or empty, so that the Agent's own default holds.
 */
export function chosen(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
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
