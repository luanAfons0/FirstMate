/**
 * Bring a 1.x install across: its Plugins, Grants, Shortcuts, Plugin Order
 * and Shelf, read from the 1.x home inside a `wsl` Place.
 *
 * A 1.x Host ran in WSL, so its Plugins already live in a distribution. Each
 * one enters that `wsl` Place with the directory it already has: nothing is
 * copied and nothing is moved, because a Plugin's data is its own (ADR-0005,
 * ADR-0021). The 1.x files are read through the Place's root, and are never
 * written.
 *
 * What cannot come across is refused one sentence at a time, and the rest
 * still comes: a Plugin Name already used in 2.0 is refused, and so is a
 * Shortcut for a Plugin that was refused or for keys already bound.
 */
import { statSync } from 'node:fs';
import { posix } from 'node:path';
import { refuse } from './refusal.ts';
import { filesOf, type Place } from './places.ts';
import { readRegistry, writeRegistry, type PluginRow } from './registry.ts';
import { readSettings, writeSettings } from './settings.ts';
import { shortcutAddress, type Shortcut } from './shortcut.ts';

/** What one import brought across, and what it refused. */
export type Imported = {
  /** The 1.x home it read, as the distribution names it. */
  readonly from: string;
  readonly plugins: readonly PluginRow[];
  readonly shortcuts: readonly Shortcut[];
  /** The whole Plugin Order, when the import changed it. */
  readonly order?: readonly string[];
  /** The Place's Shelf, when the import set it. */
  readonly shelf?: string;
  /** One sentence for each thing that did not come across. */
  readonly refused: readonly string[];
};

/** Where a 1.x Host kept its files inside the distribution. */
function oneXHomeOf(place: Place & { readonly kind: 'wsl' }): string {
  return posix.join(place.home, '.firstmate');
}

/** Read the 1.x install in this `wsl` Place and write it into this home. */
export function importOneX(home: string, place: Place): Imported {
  if (place.kind !== 'wsl') {
    throw refuse(
      'invalid',
      `${place.name} is a ${place.kind} Place. A 1.x install is in a wsl one.`,
    );
  }
  const from = oneXHomeOf(place);
  const through = filesOf(place, from);
  if (statSync(through, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw refuse('missing', `no 1.x install is in ${place.name}, at ${from}.`);
  }
  let rows: PluginRow[];
  try {
    rows = readRegistry(through);
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`The 1.x install in ${place.name} cannot be read. ${said}`, { cause });
  }
  const old = readSettings(through);

  const refused: string[] = [];
  const now = readRegistry(home);
  const plugins: PluginRow[] = [];
  for (const row of rows) {
    const taken = now.find((held) => held.name === row.name);
    if (taken !== undefined) {
      refused.push(`${row.name} is already registered in ${taken.place}, so it was not imported.`);
      continue;
    }
    plugins.push({ ...row, place: place.name });
  }
  writeRegistry(home, [...now, ...plugins]);

  const settings = readSettings(home);
  const held = settings.shortcuts ?? [];
  const imported = new Set(plugins.map((row) => row.name));
  const shortcuts: Shortcut[] = [];
  for (const shortcut of old.shortcuts ?? []) {
    if (!imported.has(shortcut.plugin)) {
      refused.push(`${shortcut.keys} opened ${shortcutAddress(shortcut)}, which was not imported.`);
    } else if ([...held, ...shortcuts].some((one) => one.keys === shortcut.keys)) {
      refused.push(`${shortcut.keys} is already bound, so it was not imported.`);
    } else {
      shortcuts.push(shortcut);
    }
  }

  const before = settings.order ?? [];
  const after = [...before, ...(old.order ?? []).filter((name) => imported.has(name))];
  const order = after.length === before.length ? undefined : after;

  // A 1.x Shelf is a path inside the distribution, so it becomes this Place's
  // Shelf, unless the operator chose one for the Place already.
  const shelf = place.shelf === undefined ? old.shelf : undefined;
  const places = (settings.places ?? []).map((one) =>
    one.name === place.name && shelf !== undefined ? { ...one, shelf } : one,
  );

  writeSettings(home, {
    ...settings,
    places,
    ...(shortcuts.length === 0 ? {} : { shortcuts: [...held, ...shortcuts] }),
    ...(order === undefined ? {} : { order }),
  });
  return {
    from,
    plugins,
    shortcuts,
    ...(order === undefined ? {} : { order }),
    ...(shelf === undefined ? {} : { shelf }),
    refused,
  };
}
