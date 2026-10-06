/**
 * What the Settings View shows, and what it changes, in the main process.
 *
 * The Settings View is a page, so it only asks (`ask.ts`). Everything it asks
 * to change is changed here, through the same `core` commands a terminal runs,
 * with the same checks and the same refusals. Then the main process reloads
 * the Host in-process. No page posts to `/reload`, and no page writes a
 * setting: the Settings View is not served by the Host, and it reaches the
 * main process only through the preload the App's own views carry (ADR-0012,
 * ADR-0018).
 *
 * It shows the Places with their Shelves, the Plugin Order, start at logon,
 * the Shortcuts and the App's version. Plugins and Grants stay in a terminal
 * and the Index Page. When `core` refuses what the operator typed, the
 * outcome names the one field it is about, so the page can mark it.
 *
 * A move in the Plugin Order is `core`'s `movePlugin`, as `firstmate order`
 * is. The Host reads the order on every request, so a move needs no reload.
 * The rows the page then shows are the order `/plugins.json` gives back,
 * read again before the page is drawn, never the order a drop made on the
 * page (ADR-0016, as ADR-0026 amends it).
 */
import { app, dialog, type BaseWindow } from 'electron';
import {
  addPlace,
  listPlaces,
  movePlugin,
  moveShelf,
  removePlace,
  shelfOf,
} from '@firstmate/core/commands';
import { readConfig } from '@firstmate/core/config';
import { canHoldWslPlace, DEFAULT_PLACE, isPlaceKind, isPlaceName } from '@firstmate/core/places';
import { refusalOf } from '@firstmate/core/refusal';
import { readRegistry } from '@firstmate/core/registry';
import { readSettings } from '@firstmate/core/settings';
import { SHELF_VARIABLE } from '@firstmate/core/shelf';
import type { Asked } from './ask.ts';
import type { Plugins } from './host-lists.ts';
import { readLogon, writeLogon } from './logon.ts';

/** One Place, as the Settings View shows it. */
export type PlaceShown = {
  readonly name: string;
  readonly kind: string;
  /** The distribution of a `wsl` Place. */
  readonly distribution?: string;
  /** The Shelf in force: a Windows path, or a path inside the distribution. */
  readonly shelf: string;
  /** Whether this is the default Place, which is always there. */
  readonly always: boolean;
  /** The Plugins in this Place, which keep it from being removed. */
  readonly plugins: readonly string[];
};

/** One Shortcut, as the Settings View shows it. */
export type ShortcutShown = {
  readonly keys: string;
  /** The Plugin whose address it opens. */
  readonly plugin: string;
  /** The path under that Plugin's address, with no leading slash. */
  readonly path: string;
};

/** Everything the Settings View says. */
export type SettingsShown = {
  /** The Places and the Shortcuts, or the sentence that says why they cannot be read. */
  readonly saved:
    | {
        readonly kind: 'read';
        readonly places: readonly PlaceShown[];
        readonly shortcuts: readonly ShortcutShown[];
      }
    | { readonly kind: 'unread'; readonly why: string };
  /** Whether the App starts at logon. */
  readonly logon: boolean;
  /** The App's version. */
  readonly version: string;
  /** Every Plugin, in the Plugin Order, as `/plugins.json` last said it. */
  readonly plugins: Plugins;
  /** What became of the last change asked for, until the next one. */
  readonly outcome?: Outcome;
  /** Whether a change is still being made, such as a distribution being asked. */
  readonly busy: boolean;
};

/** What became of one change: done, or refused, in one sentence. */
export type Outcome = {
  readonly done: boolean;
  readonly sentence: string;
  /** The field a refusal is about, when it is about one the operator typed or chose. */
  readonly field?: Field;
};

/** One field of the Settings View: one of Add a Place, or one Place's Shelf. */
export type Field =
  | { readonly form: 'place-add'; readonly name: 'name' | 'kind' | 'distribution' }
  | { readonly form: 'shelf'; readonly place: string };

/** Read what the Settings View shows, now. It never throws. */
export function readShown(home: string): Pick<SettingsShown, 'saved' | 'logon' | 'version'> {
  return { saved: readSaved(home), logon: readLogon(), version: app.getVersion() };
}

function readSaved(home: string): SettingsShown['saved'] {
  try {
    const config = readConfig();
    const rows = readRegistry(home);
    const places = listPlaces(home).map((place) => ({
      name: place.name,
      kind: place.kind,
      ...(place.kind === 'wsl' ? { distribution: place.distribution } : {}),
      shelf: shelfOf(config, place),
      always: place.name === DEFAULT_PLACE,
      plugins: rows.filter((row) => row.place === place.name).map((row) => row.name),
    }));
    const shortcuts = (readSettings(home).shortcuts ?? []).map((shortcut) => ({
      keys: shortcut.keys,
      plugin: shortcut.plugin,
      path: shortcut.path,
    }));
    return { kind: 'read', places, shortcuts };
  } catch (fault: unknown) {
    return { kind: 'unread', why: sentenceOf(fault) };
  }
}

/** What a change needs from the rest of the App. */
export type ChangeNeeds = {
  readonly home: string;
  /** Read the Registry and the settings again, in the Host. */
  readonly reload: () => Promise<void>;
  /** The window a folder dialog belongs to. */
  readonly window: () => BaseWindow | undefined;
  /** Ask the Host for its Plugins again, and hold the answer for the page. */
  readonly readBack: () => Promise<void>;
};

/**
 * Make one change the Settings View asked for, and say what became of it.
 * Nothing it is asked for that is not a setting changes anything.
 */
export async function change(asked: Asked, needs: ChangeNeeds): Promise<Outcome | undefined> {
  const outcome = await outcomeOf(asked, needs);
  // Done or refused, the rows show what the Host says now, so a refused move
  // puts them back where they are kept.
  if (asked.kind === 'plugin-move') await needs.readBack();
  return outcome;
}

async function outcomeOf(asked: Asked, needs: ChangeNeeds): Promise<Outcome | undefined> {
  try {
    const sentence = await changed(asked, needs);
    if (sentence === undefined) return undefined;
    return { done: true, sentence };
  } catch (fault: unknown) {
    const field = refusalOf(fault) === undefined ? undefined : fieldOf(asked, fault);
    return { done: false, sentence: sentenceOf(fault), ...(field === undefined ? {} : { field }) };
  }
}

/**
 * The field a refusal of this ask is about. `core` checks a Place in this
 * order: its name, its kind, then its distribution; a name already taken is
 * the name's fault too. A failure, which is no refusal, marks no field.
 */
function fieldOf(asked: Asked, fault: unknown): Field | undefined {
  if (asked.kind === 'shelf' || asked.kind === 'shelf-choose') {
    return { form: 'shelf', place: asked.place };
  }
  if (asked.kind !== 'place-add') return undefined;
  const at = (name: 'name' | 'kind' | 'distribution'): Field => ({ form: 'place-add', name });
  if (!isPlaceName(asked.name) || refusalOf(fault) === 'taken') return at('name');
  if (!isPlaceKind(asked.placeKind) || (asked.placeKind === 'wsl' && !canHoldWslPlace())) {
    return at('kind');
  }
  return asked.placeKind === 'wsl' ? at('distribution') : undefined;
}

/** The change itself, and its sentence; undefined when nothing changed. */
async function changed(asked: Asked, needs: ChangeNeeds): Promise<string | undefined> {
  const { home } = needs;
  if (asked.kind === 'logon') {
    writeLogon(asked.on);
    return asked.on ? 'FirstMate starts at logon.' : 'FirstMate no longer starts at logon.';
  }
  if (asked.kind === 'place-add') {
    const distribution = asked.distribution === undefined ? [] : [asked.distribution];
    const added = await addPlace(home, asked.name, asked.placeKind, distribution);
    await needs.reload();
    return `Added the ${added.kind} Place ${added.name}.`;
  }
  if (asked.kind === 'place-remove') {
    removePlace(home, asked.name);
    await needs.reload();
    return `Removed the Place ${asked.name}. Nothing on disk was touched.`;
  }
  if (asked.kind === 'plugin-move') {
    const moved = movePlugin(home, asked.name, asked.position);
    return `${asked.name} is now number ${moved.indexOf(asked.name) + 1} in the Plugin Order.`;
  }
  if (asked.kind === 'shelf') return shelfMoved(asked.place, asked.directory, needs);
  if (asked.kind === 'shelf-choose') {
    const chosen = await chooseFolder(asked.place, needs.window());
    return chosen === undefined ? undefined : shelfMoved(asked.place, chosen, needs);
  }
  return undefined;
}

async function shelfMoved(place: string, directory: string, needs: ChangeNeeds): Promise<string> {
  const moved = moveShelf(needs.home, directory, place);
  await needs.reload();
  const forced =
    moved.forced === undefined
      ? ''
      : ` ${SHELF_VARIABLE} is set to ${moved.forced}, and wins until it is unset.`;
  return `The Shelf of ${place} is now ${moved.shelf}.${forced}`;
}

/** Ask the operator for a folder on this machine, or nothing when they cancel. */
async function chooseFolder(
  place: string,
  window: BaseWindow | undefined,
): Promise<string | undefined> {
  const options = {
    title: `The Shelf of ${place}`,
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  };
  const chosen =
    window === undefined || window.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  return chosen.canceled ? undefined : chosen.filePaths[0];
}

/** A refusal is already a sentence; anything else is said as it came. */
function sentenceOf(fault: unknown): string {
  const said = fault instanceof Error ? fault.message : String(fault);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}
