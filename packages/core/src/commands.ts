/**
 * What the writing commands change, apart from how they are typed and
 * printed: add or remove a Place, move a Shelf, add, install or update a
 * Plugin, give a Grant, bind a Shortcut, move a Plugin in the Plugin Order.
 *
 * The terminal (`cli.ts`) and `setup` both call these, so a refusal has the
 * same words in both places. Each one either does its whole change or throws
 * the sentence that says why it did none of it. Nothing here prints.
 */
import { mkdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, posix } from 'node:path';
import type { Config } from './config.ts';
import { fetchPlugin, isGitUrl, type GitWords } from './fetch-plugin.ts';
import { readPlugins } from './plugin-places.ts';
import { refusalOf, refuse } from './refusal.ts';
import { OFFICIAL_PLUGINS, officialPlugin } from './official-plugins.ts';
import {
  allPlaces,
  canHoldWslPlace,
  DEFAULT_PLACE,
  defaultShelfOf,
  filesOf,
  isPlaceKind,
  isPlaceName,
  PLACE_KINDS,
  rootOf,
  type Place,
} from './places.ts';
import { isPluginName, readRegistry, writeRegistry, type PluginRow } from './registry.ts';
import { inPluginOrder, readSettings, writeSettings, type Settings } from './settings.ts';
import { checkShelf, defaultShelf, shelfInEnvironment } from './shelf.ts';
import { isPluginPath, readKeys, shortcutAddress, type Shortcut } from './shortcut.ts';
import { gitHere, moveForward, type Moved } from './update-plugin.ts';
import { homeIn, makeExecutable } from './wsl.ts';

/** The sentence for a name that is not a Plugin Name, in every command's words. */
export function notAPluginName(name: string): string {
  return `${name} is not a Plugin Name. Use lower-case letters, digits and hyphens.`;
}

/** The sentence for a name that is not a Place Name, in every command's words. */
function notAPlaceName(name: string): string {
  return `${name} is not a Place Name. Use lower-case letters, digits and hyphens.`;
}

/** Every Place, the default first. */
export function listPlaces(home: string): Place[] {
  return allPlaces(readSettings(home).places);
}

/** The Place of this name, or the refusal that says there is none. */
export function findPlace(home: string, name: string): Place {
  if (!isPlaceName(name)) throw refuse('invalid', notAPlaceName(name));
  const place = listPlaces(home).find((one) => one.name === name);
  if (place === undefined) throw refuse('missing', `no Place named ${name} is there.`);
  return place;
}

/**
 * The Shelf of a Place in force. The default Place's comes from the
 * environment, then the settings file, then the home directory, as the one
 * Shelf of 1.x did (ADR-0012). Any other Place's is the one chosen for it, or
 * its kind's default. A `wsl` Place's Shelf is a path inside its distribution.
 */
export function shelfOf(config: Config, place: Place): string {
  if (place.name === DEFAULT_PLACE) return config.shelf;
  return place.shelf ?? defaultShelfOf(config.home, place);
}

/** What `job` gives, with a refusal of it said to be about `word`. */
async function about<T>(word: string, job: Promise<T>): Promise<T> {
  try {
    return await job;
  } catch (fault) {
    const kind = refusalOf(fault);
    if (kind === undefined) throw fault;
    throw refuse(kind, (fault as Error).message, { cause: fault, about: word });
  }
}

/**
 * Add a Place, and give back the Place written. A local Place needs nothing
 * more. A `wsl` Place needs its distribution, and takes the Windows path its
 * files are read through when that is not `\\wsl.localhost\<distribution>`;
 * the distribution is asked for its home directory, so a distribution that
 * does not answer is refused before anything is written.
 */
export async function addPlace(
  home: string,
  name: string,
  kind: string,
  needs: readonly string[] = [],
): Promise<Place> {
  // Each refusal says which word it is about, so the Settings View marks it.
  if (!isPlaceName(name)) throw refuse('invalid', notAPlaceName(name), { about: 'name' });
  if (!isPlaceKind(kind)) {
    throw refuse(
      'invalid',
      `${kind} is not a kind of Place. The kinds are ${PLACE_KINDS.join(', ')}.`,
      { about: 'kind' },
    );
  }
  if (kind === 'wsl' && !canHoldWslPlace()) {
    throw refuse('invalid', 'a wsl Place runs on Windows only, and this machine is not Windows.', {
      about: 'kind',
    });
  }
  if (allPlaces(readSettings(home).places).some((place) => place.name === name)) {
    throw refuse('taken', `a Place named ${name} is there already.`, { about: 'name' });
  }
  const [distribution, root, ...more] = needs;
  let place: Place;
  if (kind === 'local') {
    if (needs.length > 0) throw refuse('invalid', 'a local Place needs nothing more.');
    place = { name, kind };
  } else {
    if (distribution === undefined || more.length > 0) {
      throw refuse(
        'invalid',
        'a wsl Place needs its distribution, and may take its Windows path.',
        {
          about: 'distribution',
        },
      );
    }
    place = {
      name,
      kind,
      distribution,
      root: root ?? rootOf(distribution),
      home: await about('distribution', homeIn(distribution)),
    };
  }
  // Read again: the distribution may have taken its time to answer.
  const settings = readSettings(home);
  writeSettings(home, { ...settings, places: [...(settings.places ?? []), place] });
  return place;
}

/**
 * Take a Place away. A Place that holds a Plugin is refused, because the
 * Plugin would be left in no Place at all; the default Place is refused,
 * because it is this machine and is always there. Nothing on disk is touched.
 */
export function removePlace(home: string, name: string): void {
  const place = findPlace(home, name);
  if (place.name === DEFAULT_PLACE) {
    throw refuse('invalid', `${name} is this machine, and is always there.`);
  }
  const held = readRegistry(home).filter((row) => row.place === name);
  if (held.length > 0) {
    throw refuse(
      'taken',
      `${name} holds ${held.map((row) => row.name).join(', ')}. Remove ${
        held.length === 1 ? 'it' : 'them'
      } first.`,
    );
  }
  const settings = readSettings(home);
  const left = (settings.places ?? []).filter((one) => one.name !== name);
  writeSettings(home, { ...settings, places: left.length === 0 ? undefined : left });
}

/** What moving a Shelf did. */
export type ShelfMoved = {
  /** The real path now remembered as the Shelf. */
  readonly shelf: string;
  /** The Shelf the environment forces over it, when that is another one. */
  readonly forced?: string;
};

/**
 * Remember this directory as a Place's Shelf, the default Place's unless
 * another is named. It is checked before it is remembered, and what is
 * remembered is the real path. A `wsl` Place's Shelf is checked through the
 * Place's root, and remembered as the distribution's own path.
 */
export function moveShelf(home: string, directory: string, placeName = DEFAULT_PLACE): ShelfMoved {
  const place = findPlace(home, placeName);
  const shelf =
    place.kind === 'wsl' ? wslShelf(place, directory, home) : checkShelf(directory, home);
  const settings = readSettings(home);
  if (place.name !== DEFAULT_PLACE) {
    const places = (settings.places ?? []).map((one) =>
      one.name === place.name ? { ...one, shelf } : one,
    );
    writeSettings(home, { ...settings, places });
    return { shelf };
  }
  writeSettings(home, { ...settings, shelf });
  const forced = shelfInEnvironment();
  return forced !== undefined && forced !== shelf ? { shelf, forced } : { shelf };
}

/**
 * A Shelf inside a distribution, checked as every Shelf is, through the
 * Place's root, and given back as the distribution's own path.
 */
function wslShelf(place: Place, directory: string, home: string): string {
  if (!directory.startsWith('/')) {
    throw refuse('invalid', `${directory} is not a path inside ${place.name}. Start it with /.`);
  }
  checkShelf(filesOf(place, directory), home);
  return posix.normalize(directory);
}

/**
 * Register a Plugin whose directory is already where it will stay, and give
 * back the row written. Nothing is copied: the Registry holds the path. A
 * `wsl` Plugin's directory is the distribution's own path, read through the
 * Place's root.
 */
export function addPlugin(
  home: string,
  name: string,
  directory: string,
  placeName = DEFAULT_PLACE,
): PluginRow {
  if (!isPluginName(name)) throw refuse('invalid', notAPluginName(name));
  const place = findPlace(home, placeName);
  const absolute = place.kind === 'wsl' ? directory.startsWith('/') : isAbsolute(directory);
  if (!absolute) throw refuse('invalid', `${directory} is not an absolute path.`);
  const found = statSync(filesOf(place, directory), { throwIfNoEntry: false });
  if (found === undefined || !found.isDirectory()) {
    throw refuse('invalid', `${directory} is not a directory.`);
  }
  const rows = readRegistry(home);
  refuseTaken(rows, name);
  const row: PluginRow = { name, place: place.name, directory, grants: [] };
  writeRegistry(home, [...rows, row]);
  return row;
}

/**
 * Refuse a Plugin Name the Registry already holds, in whichever Place: a
 * Plugin Name is an address, and `/p/<name>/` serves one Plugin.
 */
function refuseTaken(rows: readonly PluginRow[], name: string): void {
  const taken = rows.find((row) => row.name === name);
  if (taken !== undefined) {
    throw refuse(
      'taken',
      `${name} is already registered in ${taken.place}, at ${taken.directory}.`,
    );
  }
}

/**
 * Fetch a Plugin into a Place's Shelf and register it in that Place, the
 * default Place unless another is named, and give back the row written. A
 * source is a git URL, an absolute directory, or the Plugin Name of an
 * Official Plugin, in that order (ADR-0015).
 *
 * It follows `add` step for step once the files have landed, because a Plugin
 * that was fetched is a Plugin like any other. Nothing the Plugin ships runs
 * here: its executable runs later, when the Host starts it. `words` says
 * where git's words go while it clones.
 */
export async function installPlugin(
  config: Config,
  source: string,
  given?: string,
  placeName = DEFAULT_PLACE,
  words: GitWords = 'shown',
): Promise<PluginRow> {
  const official = isGitUrl(source) || isAbsolute(source) ? undefined : officialPlugin(source);
  const name = given ?? official?.name ?? nameOf(source);
  if (!isPluginName(name)) {
    if (given === undefined) {
      throw refuse(
        'invalid',
        `${source} does not name a Plugin. Give the name yourself: ` +
          `firstmate install ${source} <name>`,
      );
    }
    throw refuse('invalid', notAPluginName(name));
  }
  const place = findPlace(config.home, placeName);
  const from = official?.url ?? checkSource(source);

  // Refused before anything is fetched, so a refusal costs no copying and a
  // Plugin that is running is never replaced under it.
  refuseTaken(readRegistry(config.home), name);

  // A default Shelf is inside the Host's home directory, which the Host
  // makes for itself, so install works before anything has been chosen. A
  // Shelf the operator named is theirs to make, so that a typo is refused
  // rather than created.
  const chosen = shelfOf(config, place);
  if (chosen === defaultShelf(config.home) || chosen === defaultShelfOf(config.home, place)) {
    mkdirSync(filesOf(place, chosen), { recursive: true, mode: 0o700 });
  }
  // Checked on every run. The remembered Shelf is never trusted as already
  // checked, because a path that was a directory yesterday can be a symlink
  // today.
  const shelf = checkShelf(filesOf(place, chosen), config.home);
  const landed = await fetchPlugin(from, shelf, name, words);
  // A `wsl` Plugin is registered by the distribution's own path, and the
  // files written from Windows lost the executable bit on their way in.
  const directory = place.kind === 'wsl' ? posix.join(chosen, name) : landed;
  if (place.kind === 'wsl' && statSync(join(landed, 'mcp'), { throwIfNoEntry: false })?.isFile()) {
    await makeExecutable(place.distribution, directory);
  }

  // Read again, because a clone can take minutes, and a row another command
  // wrote in the meantime must not be lost to the rows read before it.
  const now = readRegistry(config.home);
  const late = now.find((row) => row.name === name);
  if (late !== undefined) {
    throw refuse(
      'taken',
      `${name} was registered at ${late.directory} while it was fetched. ` +
        `The files are at ${directory}; take them away, or add them under another name.`,
    );
  }
  const row: PluginRow = { name, place: place.name, directory, grants: [] };
  writeRegistry(config.home, [...now, row]);
  return row;
}

/**
 * Move a Plugin that is a git clone forward to its upstream, and say from
 * which commit to which, or give back nothing when there was nothing to move
 * (ADR-0030). The name is checked as `restart` checks it. Restarting the
 * Plugin Server is the caller's, because only a terminal reaches the Host.
 */
export async function updatePlugin(home: string, name: string): Promise<Moved | undefined> {
  if (!isPluginName(name)) throw refuse('invalid', notAPluginName(name));
  const plugin = readPlugins(home).find((row) => row.name === name);
  if (plugin === undefined) throw refuse('missing', `no Plugin named ${name} is registered.`);
  if (plugin.runner.kind === 'nowhere') {
    throw refuse('invalid', `${name} cannot be updated: ${plugin.runner.why}.`);
  }
  if (plugin.runner.kind === 'wsl') {
    throw refuse(
      'invalid',
      `${name} is in ${plugin.place}, a wsl Place, and update does not reach a wsl Place yet: ` +
        `run git pull --ff-only in ${plugin.directory} inside ${plugin.runner.distribution}, ` +
        `then firstmate restart ${name}.`,
    );
  }
  if (statSync(plugin.files, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw refuse('invalid', `${plugin.directory} is not a directory.`);
  }
  return moveForward(gitHere(plugin.files), name, plugin.directory);
}

/**
 * A source that is no Official Plugin, checked: a git URL, or an absolute
 * path to a directory. A bare name that names no Official Plugin says which
 * names do.
 */
function checkSource(source: string): string {
  if (isGitUrl(source)) return source;
  if (isAbsolute(source)) {
    const found = statSync(source, { throwIfNoEntry: false });
    if (found === undefined || !found.isDirectory()) {
      throw refuse('invalid', `${source} is not a directory.`);
    }
    return source;
  }
  if (!/[/\\]/.test(source)) {
    throw refuse(
      'invalid',
      `${source} is not a directory, not a URL and not an Official Plugin. ` +
        `The Official Plugins are ${OFFICIAL_PLUGINS.map((plugin) => plugin.name).join(', ')}.`,
    );
  }
  throw refuse('invalid', `${source} is not an absolute path, and is no URL either.`);
}

/**
 * The Plugin Name a source suggests: its last segment, with no git suffix. In
 * the short form of a git URL, `git@host:plugin.git`, a colon ends a segment
 * too.
 */
function nameOf(source: string): string {
  const trimmed = source.replace(/[/\\]+$/, '');
  if (!isGitUrl(trimmed)) return basename(trimmed);
  return (trimmed.split(/[/\\:]/).pop() ?? '').replace(/\.git$/, '');
}

/**
 * Let one Plugin call another's tools. It gives back false when the Grant was
 * there already, and writes nothing then.
 */
export function givePermission(home: string, from: string, to: string): boolean {
  const rows = readRegistry(home);
  const { fromRow, fromIndex } = findPair(rows, from, to);
  if (fromRow.grants.includes(to)) return false;

  const rewritten = rows.slice();
  rewritten[fromIndex] = { ...fromRow, grants: [...fromRow.grants, to] };
  writeRegistry(home, rewritten);
  return true;
}

/**
 * Take a Grant back. It gives back false when there was no Grant to take, and
 * writes nothing then.
 */
export function takePermission(home: string, from: string, to: string): boolean {
  const rows = readRegistry(home);
  const { fromRow, fromIndex } = findPair(rows, from, to);
  if (!fromRow.grants.includes(to)) return false;

  const rewritten = rows.slice();
  rewritten[fromIndex] = { ...fromRow, grants: fromRow.grants.filter((name) => name !== to) };
  writeRegistry(home, rewritten);
  return true;
}

/**
 * Both Plugin Names of a Grant, checked and resolved against the Registry. A
 * Grant that named a Plugin that does not exist would be a Grant the operator
 * misreads later, so both commands refuse before they write anything.
 */
function findPair(
  rows: readonly PluginRow[],
  from: string,
  to: string,
): { readonly fromRow: PluginRow; readonly fromIndex: number } {
  for (const name of [from, to]) {
    if (!isPluginName(name)) throw refuse('invalid', notAPluginName(name));
  }
  const fromRow = rows.find((row) => row.name === from);
  if (fromRow === undefined) throw refuse('missing', `no Plugin named ${from} is registered.`);
  if (!rows.some((row) => row.name === to)) {
    throw refuse('missing', `no Plugin named ${to} is registered.`);
  }
  return { fromRow, fromIndex: rows.indexOf(fromRow) };
}

/** The keys in normal form, or the sentence that says what is wrong with them. */
export function checkKeys(typed: string): string {
  const read = readKeys(typed);
  if (read.kind === 'wrong') throw refuse('invalid', read.reason);
  return read.chord.keys;
}

/** Refuse keys that a Shortcut already holds, and say which one. */
export function checkKeysFree(home: string, keys: string): void {
  const held = (readSettings(home).shortcuts ?? []).find((shortcut) => shortcut.keys === keys);
  if (held !== undefined) {
    throw refuse(
      'taken',
      `${keys} is already bound to ${held.plugin}, to open ` +
        `${shortcutAddress(held)}. Unbind it first: firstmate unbind ${keys}`,
    );
  }
}

/** Refuse a path that leaves its Plugin's address. */
export function checkShortcutPath(path: string, plugin: string): void {
  if (!isPluginPath(path, plugin)) {
    throw refuse(
      'invalid',
      `${path} is not a path inside ${plugin}'s address. Give it relative, ` +
        'with no leading slash and no "..".',
    );
  }
}

/**
 * Bind keys to one address of one Plugin, for the App to hold in all of
 * Windows, and give back the Shortcut written.
 *
 * Binding is a write, and like moving the Shelf it is done from a terminal and
 * from nowhere else: every Plugin Page shares the Index Page's origin, so an
 * address that bound a Shortcut would let any Plugin take a key in all of
 * Windows (ADR-0013).
 */
export function bindShortcut(home: string, typed: string, plugin: string, path: string): Shortcut {
  const keys = checkKeys(typed);
  if (!readRegistry(home).some((row) => row.name === plugin)) {
    throw refuse('missing', `no Plugin named ${plugin} is registered.`);
  }
  checkShortcutPath(path, plugin);
  checkKeysFree(home, keys);

  const settings = readSettings(home);
  const shortcut: Shortcut = { keys, plugin, path };
  writeSettings(home, withShortcuts(settings, [...(settings.shortcuts ?? []), shortcut]));
  return shortcut;
}

/**
 * The settings with these Shortcuts in them. No Shortcut at all leaves no
 * array behind, because JSON writes no undefined field, so a file that never
 * held one reads as it did before.
 */
export function withShortcuts(settings: Settings, shortcuts: readonly Shortcut[]): Settings {
  return { ...settings, shortcuts: shortcuts.length === 0 ? undefined : shortcuts };
}

/** Every Plugin Name in the Registry, in the Plugin Order. */
export function pluginOrder(home: string): string[] {
  const rows = readRegistry(home);
  return inPluginOrder(rows, readSettings(home).order ?? []).map((row) => row.name);
}

/**
 * Move one Plugin to a position in the Plugin Order, counted from 1 at the
 * top, and give back the whole order written. The other Plugins keep their
 * order. The whole order is written, so that what the operator reads back is
 * what every list shows.
 *
 * Like every other setting it is written from a terminal and from nowhere
 * else: a Plugin Page shares the Index Page's origin, and an address that
 * moved a Plugin would let any Plugin reorder the operator's (ADR-0016).
 */
export function movePlugin(home: string, name: string, typed: string): string[] {
  if (!isPluginName(name)) throw refuse('invalid', notAPluginName(name));
  const order = pluginOrder(home);
  if (!order.includes(name)) throw refuse('missing', `no Plugin named ${name} is registered.`);
  const position = Number(typed);
  if (!/^\d+$/.test(typed) || position < 1 || position > order.length) {
    throw refuse(
      'invalid',
      `${typed} is not a position. Give a whole number from 1 to ${order.length}.`,
    );
  }
  const others = order.filter((other) => other !== name);
  const moved = [...others.slice(0, position - 1), name, ...others.slice(position - 1)];
  writeSettings(home, { ...readSettings(home), order: moved });
  return moved;
}

/**
 * The settings with this Plugin taken out of the Plugin Order. An order left
 * empty leaves no array behind, so a file that never held one reads as it did
 * before.
 */
export function withoutInOrder(settings: Settings, name: string): Settings {
  const order = (settings.order ?? []).filter((other) => other !== name);
  return { ...settings, order: order.length === 0 ? undefined : order };
}
