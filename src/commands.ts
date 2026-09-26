/**
 * What the writing commands change, apart from how they are typed and
 * printed: move the Shelf, install a Plugin, give a Grant, bind a Shortcut.
 *
 * The terminal (`cli.ts`) and `setup` both call these, so a refusal has the
 * same words in both places. Each one either does its whole change or throws
 * the sentence that says why it did none of it. Nothing here prints.
 */
import { mkdirSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { Config } from './config.ts';
import { fetchPlugin, isGitUrl } from './fetch-plugin.ts';
import { OFFICIAL_PLUGINS, officialPlugin } from './official-plugins.ts';
import { isPluginName, readRegistry, writeRegistry, type PluginRow } from './registry.ts';
import { readSettings, writeSettings, type Settings } from './settings.ts';
import { checkShelf, defaultShelf, shelfInEnvironment } from './shelf.ts';
import { isPluginPath, readKeys, shortcutAddress, type Shortcut } from './shortcut.ts';

/** The sentence for a name that is not a Plugin Name, in every command's words. */
export function notAPluginName(name: string): string {
  return `${name} is not a Plugin Name. Use lower-case letters, digits and hyphens.`;
}

/** What moving the Shelf did. */
export type ShelfMoved = {
  /** The real path now remembered as the Shelf. */
  readonly shelf: string;
  /** The Shelf the environment forces over it, when that is another one. */
  readonly forced?: string;
};

/**
 * Remember this directory as the Shelf. It is checked before it is
 * remembered, and what is remembered is the real path.
 */
export function moveShelf(home: string, directory: string): ShelfMoved {
  const shelf = checkShelf(directory, home);
  writeSettings(home, { ...readSettings(home), shelf });
  const forced = shelfInEnvironment();
  return forced !== undefined && forced !== shelf ? { shelf, forced } : { shelf };
}

/**
 * Fetch a Plugin into the Shelf and register it, and give back the row
 * written. A source is a git URL, an absolute directory, or the Plugin Name of
 * an Official Plugin, in that order (ADR-0015).
 *
 * It follows `add` step for step once the files have landed, because a Plugin
 * that was fetched is a Plugin like any other. Nothing the Plugin ships runs
 * here: its executable runs later, when the Host starts it.
 */
export async function installPlugin(
  config: Config,
  source: string,
  given?: string,
): Promise<PluginRow> {
  const official = isGitUrl(source) || isAbsolute(source) ? undefined : officialPlugin(source);
  const name = given ?? official?.name ?? nameOf(source);
  if (!isPluginName(name)) {
    if (given === undefined) {
      throw new Error(
        `${source} does not name a Plugin. Give the name yourself: ` +
          `firstmate install ${source} <name>`,
      );
    }
    throw new Error(notAPluginName(name));
  }
  const from = official?.url ?? checkSource(source);

  // Refused before anything is fetched, so a refusal costs no copying and a
  // Plugin that is running is never replaced under it.
  const taken = readRegistry(config.home).find((row) => row.name === name);
  if (taken !== undefined) {
    throw new Error(`${name} is already registered, at ${taken.directory}.`);
  }

  // The default Shelf is inside the Host's home directory, which the Host
  // makes for itself, so install works before anything has been chosen. A
  // Shelf the operator named is theirs to make, so that a typo is refused
  // rather than created.
  if (config.shelf === defaultShelf(config.home)) {
    mkdirSync(config.shelf, { recursive: true, mode: 0o700 });
  }
  // Checked on every run. The remembered Shelf is never trusted as already
  // checked, because a path that was a directory yesterday can be a symlink
  // today.
  const shelf = checkShelf(config.shelf, config.home);
  const directory = await fetchPlugin(from, shelf, name);

  // Read again, because a clone can take minutes, and a row another command
  // wrote in the meantime must not be lost to the rows read before it.
  const now = readRegistry(config.home);
  const late = now.find((row) => row.name === name);
  if (late !== undefined) {
    throw new Error(
      `${name} was registered at ${late.directory} while it was fetched. ` +
        `The files are at ${directory}; take them away, or add them under another name.`,
    );
  }
  const row: PluginRow = { name, directory, grants: [] };
  writeRegistry(config.home, [...now, row]);
  return row;
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
      throw new Error(`${source} is not a directory.`);
    }
    return source;
  }
  if (!/[/\\]/.test(source)) {
    throw new Error(
      `${source} is not a directory, not a URL and not an Official Plugin. ` +
        `The Official Plugins are ${OFFICIAL_PLUGINS.map((plugin) => plugin.name).join(', ')}.`,
    );
  }
  throw new Error(`${source} is not an absolute path, and is no URL either.`);
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
    if (!isPluginName(name)) throw new Error(notAPluginName(name));
  }
  const fromRow = rows.find((row) => row.name === from);
  if (fromRow === undefined) throw new Error(`no Plugin named ${from} is registered.`);
  if (!rows.some((row) => row.name === to)) {
    throw new Error(`no Plugin named ${to} is registered.`);
  }
  return { fromRow, fromIndex: rows.indexOf(fromRow) };
}

/** The keys in normal form, or the sentence that says what is wrong with them. */
export function checkKeys(typed: string): string {
  const read = readKeys(typed);
  if (read.kind === 'wrong') throw new Error(read.reason);
  return read.chord.keys;
}

/** Refuse keys that a Shortcut already holds, and say which one. */
function checkKeysFree(home: string, keys: string): void {
  const held = (readSettings(home).shortcuts ?? []).find((shortcut) => shortcut.keys === keys);
  if (held !== undefined) {
    throw new Error(
      `${keys} is already bound to ${held.plugin}, to open ` +
        `${shortcutAddress(held)}. Unbind it first: firstmate unbind ${keys}`,
    );
  }
}

/** Refuse a path that leaves its Plugin's address. */
function checkShortcutPath(path: string, plugin: string): void {
  if (!isPluginPath(path, plugin)) {
    throw new Error(
      `${path} is not a path inside ${plugin}'s address. Give it relative, ` +
        'with no leading slash and no "..".',
    );
  }
}

/**
 * Bind keys to one address of one Plugin, for the Tray to hold in all of
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
    throw new Error(`no Plugin named ${plugin} is registered.`);
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
