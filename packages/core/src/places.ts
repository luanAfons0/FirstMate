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
import { join, posix } from 'node:path';
import { isPluginName } from './registry.ts';

/**
 * The default Place: this machine. The App runs on Windows, so there it is
 * `windows`. Elsewhere it is the only Place a Host has, and says so plainly.
 */
export const DEFAULT_PLACE = process.platform === 'win32' ? 'windows' : 'local';

/** Every kind of Place. */
export const PLACE_KINDS = ['local', 'wsl'] as const;

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

/**
 * A Place that is one WSL distribution. Its Plugins keep their `mcp` file as
 * it is, and run inside the distribution through `wsl.exe`. Its paths are the
 * distribution's own, and the Host reads its files through `root`, the
 * Windows path the distribution is reached by.
 */
type WslPlace = {
  readonly name: string;
  readonly kind: 'wsl';
  /** The WSL distribution, as `wsl.exe -d` names it. */
  readonly distribution: string;
  /**
   * The Windows path the distribution's files are read through, by default
   * `\\wsl.localhost\<distribution>`. A test points it at a folder of its own.
   */
  readonly root: string;
  /** The home directory of the distribution's user, asked for when the Place was added. */
  readonly home: string;
  /** The Shelf the operator chose, a path inside the distribution. */
  readonly shelf?: string;
};

/** A named location where Plugins are installed and their Plugin Servers run. */
export type Place = LocalPlace | WslPlace;

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
 * Where a Place's Shelf is when nobody has chosen one. A local Place has a
 * directory of its own in the home directory, beside the default Place's
 * `shelf`, so that two Places never share one. A `wsl` Place has the Shelf a
 * 1.x Host kept in that distribution, `~/.firstmate/shelf`.
 */
export function defaultShelfOf(home: string, place: Place): string {
  if (place.kind === 'wsl') return posix.join(place.home, '.firstmate', 'shelf');
  return join(home, 'shelves', place.name);
}

/**
 * The path this machine reads a Place's directory through. A local Place's
 * paths are this machine's own; a `wsl` Place's are read under its root.
 */
export function filesOf(place: Place, directory: string): string {
  return place.kind === 'wsl' ? join(place.root, directory) : directory;
}

/** The Windows path a WSL distribution's files are read through, when no other is given. */
export function rootOf(distribution: string): string {
  return `\\\\wsl.localhost\\${distribution}`;
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
    const record = item as Record<string, unknown>;
    const { name, kind, shelf } = record;
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
    const chosen = shelf === undefined ? {} : { shelf };
    if (kind === 'local') return { name, kind, ...chosen };
    const { distribution, root, home } = record;
    for (const [field, value] of [
      ['distribution', distribution],
      ['root', root],
      ['home', home],
    ] as const) {
      if (typeof value !== 'string' || value === '') {
        throw new Error(`${where} is a wsl Place, and needs "${field}".`);
      }
    }
    return {
      name,
      kind,
      distribution: distribution as string,
      root: root as string,
      home: home as string,
      ...chosen,
    };
  });
  const seen = new Set<string>();
  for (const { name } of places) {
    if (seen.has(name)) throw new Error(`The settings at ${path} name the Place ${name} twice.`);
    seen.add(name);
  }
  return places;
}
