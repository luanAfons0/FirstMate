/**
 * Places: the named locations where Plugins are installed and their Plugin
 * Servers run.
 *
 * A Place is data in the settings file: a name, a kind, and what that kind
 * needs. A new kind is one more entry in that data, not a new code path in
 * every command (ADR-0021). The default Place is this machine, and it has no
 * entry at all: it is there before anything is written, so the Host, which
 * writes no setting, never has to make it, and its Shelf is the one setting
 * 1.x kept, `shelf`, at the top of the settings file (ADR-0012).
 */
import { join } from 'node:path';
import { isPluginName } from './registry.ts';

/**
 * The default Place: this machine. The App runs on Windows, so there it is
 * `windows`. Elsewhere it is the only Place a Host has, and says so plainly.
 */
export const DEFAULT_PLACE = process.platform === 'win32' ? 'windows' : 'local';

/** Every kind of Place, and what each one needs. */
export const PLACE_KINDS = ['local'] as const;

/** One kind of Place. */
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * A Place that runs its Plugin Servers on this machine, as processes of the
 * Host's own. Its Shelf is a directory here.
 */
type LocalPlace = {
  readonly name: string;
  readonly kind: 'local';
  /**
   * The Shelf the operator chose for this Place, absent until one is chosen.
   * The default Place keeps its own at the top of the settings file.
   */
  readonly shelf?: string;
};

/** A named location where Plugins are installed and their Plugin Servers run. */
export type Place = LocalPlace;

/** Whether this is a Place Name: the same rule as a Plugin Name, for the same reasons. */
export function isPlaceName(name: string): boolean {
  return isPluginName(name);
}

/** Whether this word names a kind of Place. */
export function isPlaceKind(kind: string): kind is PlaceKind {
  return (PLACE_KINDS as readonly string[]).includes(kind);
}

/**
 * Every Place, the default first. The default Place is there whether or not
 * anything was written, so a FirstMate that was never configured has one
 * Place, as a 1.x install had one machine.
 */
export function allPlaces(added: readonly Place[] | undefined): Place[] {
  return [{ name: DEFAULT_PLACE, kind: 'local' }, ...(added ?? [])];
}

/**
 * Where a Place's Shelf is when nobody has chosen one: a directory of its own
 * in the home directory, beside the default Place's `shelf`, so that two
 * Places never share one.
 */
export function defaultShelfOf(home: string, place: string): string {
  return join(home, 'shelves', place);
}

/**
 * The Places in the settings file, each checked. A damaged one fails every
 * command, as a damaged Shortcut does, rather than being dropped in silence.
 */
export function parsePlaces(value: unknown, path: string): Place[] {
  if (!Array.isArray(value)) {
    throw new Error(`The settings at ${path} need "places" to be an array.`);
  }
  const places = value.map((item: unknown, at): Place => {
    const where = `The Place at position ${at} in the settings at ${path}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${where} needs to be a JSON object.`);
    }
    const { name, kind, shelf } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !isPlaceName(name)) {
      throw new Error(`${where} needs "name" of lower-case letters, digits and hyphens.`);
    }
    if (name === DEFAULT_PLACE) {
      throw new Error(
        `${where} is ${DEFAULT_PLACE}, which is always there and is written nowhere.`,
      );
    }
    if (typeof kind !== 'string' || !isPlaceKind(kind)) {
      throw new Error(`${where} needs "kind" to be one of ${PLACE_KINDS.join(', ')}.`);
    }
    if (shelf !== undefined && typeof shelf !== 'string') {
      throw new Error(`${where} needs "shelf" to be a path.`);
    }
    return { name, kind, ...(shelf === undefined ? {} : { shelf }) };
  });
  const seen = new Set<string>();
  for (const { name } of places) {
    if (seen.has(name)) throw new Error(`The settings at ${path} name the Place ${name} twice.`);
    seen.add(name);
  }
  return places;
}
