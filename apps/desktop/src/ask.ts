/**
 * What one of the App's own views asks the main process for: the strip, the
 * switcher, the Settings View, the Mate panel and the Mate box.
 *
 * Those views are pages the App writes, never pages the Host serves
 * (ADR-0008), and the one way they reach the main process is the preload that
 * only they carry. It hands the main process one string, and this reads it.
 * A Plugin Page has no preload, so it has no way to ask anything at all.
 *
 * The other way, the main process sends each of those views what it shows,
 * on its own channel, and the page puts it in place (`pages.ts`).
 *
 * This file imports nothing but types, because the preload carries it into a
 * sandboxed page, where Node's modules do not exist.
 */
import type { MateWords } from '@firstmate/core/agents';

/** The IPC channel an App view asks on. */
export const ASK_CHANNEL = 'firstmate:ask';

/**
 * The IPC channel the main process sends an App view what it shows on: the
 * page's body, as one HTML string, which the page puts in place of its own.
 */
export const SHOW_CHANNEL = 'firstmate:show';

/** What an App view asked for. */
export type Asked =
  /** Show the Index Page. */
  | { readonly kind: 'plugin-list' }
  /** Open the switcher, or close it when it is open. */
  | { readonly kind: 'switcher' }
  /** The same, asked from the keyboard, so the switcher shows with no fade. */
  | { readonly kind: 'switcher-keys' }
  /** Close the switcher. */
  | { readonly kind: 'switcher-close' }
  /** Show one Plugin Page. */
  | { readonly kind: 'open'; readonly name: string }
  /** Show one Plugin's Plugin Settings, at `#settings` of its Plugin Page (ADR-0029). */
  | { readonly kind: 'plugin-settings'; readonly name: string }
  /** Start one Plugin's Plugin Server again, as `firstmate restart` does. */
  | { readonly kind: 'restart'; readonly name: string }
  /** Open the Settings View, or close it when it is open. */
  | { readonly kind: 'settings' }
  /** Turn start at logon on or off. */
  | { readonly kind: 'logon'; readonly on: boolean }
  /** Add a Place: a local one, or a `wsl` one in this distribution. */
  | {
      readonly kind: 'place-add';
      readonly name: string;
      readonly placeKind: string;
      readonly distribution?: string;
    }
  /** Remove a Place. */
  | { readonly kind: 'place-remove'; readonly name: string }
  /** Move a Place's Shelf to this directory. */
  | { readonly kind: 'shelf'; readonly place: string; readonly directory: string }
  /** Ask the operator for a folder, and move a Place's Shelf there. */
  | { readonly kind: 'shelf-choose'; readonly place: string }
  /** Move one Plugin to a position in the Plugin Order, counted from 1 at the top. */
  | { readonly kind: 'plugin-move'; readonly name: string; readonly position: string }
  /**
   * Keep the Mate settings: the Agent, the model, the effort, the Place and
   * the program, each as typed, empty for the Agent's own default.
   */
  | ({ readonly kind: 'mate-set' } & MateWords)
  /** Open the Mate panel, or close it when it is open. */
  | { readonly kind: 'mate' }
  /** Close the Mate panel. */
  | { readonly kind: 'mate-close' }
  /** Start a new Conversation in the Mate panel. */
  | { readonly kind: 'mate-new' }
  /** Show Recents in the Mate panel: every Conversation. */
  | { readonly kind: 'mate-recents' }
  /** Leave Recents, back to the Conversation the panel shows. */
  | { readonly kind: 'mate-back' }
  /** Open one Conversation from Recents, by its ID. */
  | { readonly kind: 'mate-open'; readonly id: string }
  /** Delete one Conversation from Recents, by its ID: FirstMate's file of it alone. */
  | { readonly kind: 'mate-delete'; readonly id: string }
  /** Give the Mate panel the whole width below the strip, or give it back its side. */
  | { readonly kind: 'mate-expand' }
  /** Open the Settings View from the Mate panel. */
  | { readonly kind: 'mate-settings' }
  /** Ask the Mate this from the box above the Plugin list, in a new Conversation in the panel. */
  | { readonly kind: 'mate-ask'; readonly text: string }
  /** Ask the Mate this, in the panel's Conversation. */
  | { readonly kind: 'mate-send'; readonly text: string }
  /** Stop the answer that arrives in the panel's Conversation. */
  | { readonly kind: 'mate-stop' }
  /** Copy one answer of the panel's Conversation, counted from 0 among its messages. */
  | { readonly kind: 'mate-copy'; readonly message: number }
  /** Open a link of an answer in the operator's browser. */
  | { readonly kind: 'mate-link'; readonly address: string }
  /** Make the Mate panel this many logical pixels wide. */
  | { readonly kind: 'mate-width'; readonly width: number }
  /** Nothing the App knows. Nothing happens. */
  | { readonly kind: 'nothing' };

/** The words each view says, for each thing that carries nothing with it. */
export const ASK = {
  pluginList: 'plugin-list',
  switcher: 'switcher',
  switcherKeys: 'switcher-keys',
  switcherClose: 'switcher-close',
  settings: 'settings',
  mate: 'mate',
  mateClose: 'mate-close',
  mateNew: 'mate-new',
  mateRecents: 'mate-recents',
  mateBack: 'mate-back',
  mateExpand: 'mate-expand',
  mateSettings: 'mate-settings',
  mateStop: 'mate-stop',
} as const;

/** The words that ask to copy one answer of the Mate panel's Conversation. */
export function mateCopyAsk(message: number): string {
  return said('mate-copy', String(message));
}

/** The words that ask to open one Conversation from Recents. */
export function mateOpenAsk(id: string): string {
  return said('mate-open', id);
}

/** The words that ask to delete one Conversation from Recents. */
export function mateDeleteAsk(id: string): string {
  return said('mate-delete', id);
}

/** The words that ask to open a link of an answer in the operator's browser. */
export function mateLinkAsk(address: string): string {
  return said('mate-link', address);
}

/** The words that ask to show one Plugin Page. */
export function openAsk(name: string): string {
  return said('open', name);
}

/**
 * The words that ask to show one Plugin's Plugin Settings. They carry the
 * Plugin Name alone: the main process makes the address, so the Settings View
 * can ask for no other one (ADR-0029).
 */
export function pluginSettingsAsk(name: string): string {
  return said('plugin-settings', name);
}

/** The words that ask to start one Plugin's Plugin Server again. */
export function restartAsk(name: string): string {
  return said('restart', name);
}

/** The words that ask to turn start at logon on or off. */
export function logonAsk(on: boolean): string {
  return said('logon', on ? 'on' : 'off');
}

/** The words that ask to remove a Place. */
export function placeRemoveAsk(name: string): string {
  return said('place-remove', name);
}

/** The words that ask for a folder for a Place's Shelf. */
export function shelfChooseAsk(place: string): string {
  return said('shelf-choose', place);
}

/**
 * The first words of an ask whose last part the page fills in from what the
 * operator typed or did: `place-add/<name>/<kind>[/<distribution>]`,
 * `shelf/<place>/<directory>`, `plugin-move/<name>/<position>` and
 * `mate-set/<agent>/<model>/<effort>/<place>/<program>`, whose parts may be
 * empty. The page joins each part encoded.
 */
export const TYPED = {
  placeAdd: 'place-add',
  shelf: 'shelf',
  pluginMove: 'plugin-move',
  mateSet: 'mate-set',
  mateSend: 'mate-send',
  mateAsk: 'mate-ask',
  mateWidth: 'mate-width',
} as const;

/** Words, with every part encoded, so that a slash in a part stays inside it. */
function said(kind: string, ...parts: readonly string[]): string {
  return [kind, ...parts.map(encodeURIComponent)].join('/');
}

/**
 * What a view asked for. It never throws: what it cannot read asks for
 * nothing. A name or a path is handed on as it was asked for: the main process
 * opens a Plugin only when the Host named it, and `core` checks everything
 * else the Settings View asks to write, as it checks a terminal's.
 */
export function readAsked(said: unknown): Asked {
  if (typeof said !== 'string') return { kind: 'nothing' };
  for (const kind of Object.values(ASK)) {
    if (said === kind) return { kind };
  }
  const [kind, ...encoded] = said.split('/');
  let parts: string[];
  try {
    parts = encoded.map(decodeURIComponent);
  } catch {
    return { kind: 'nothing' };
  }
  if (kind === 'mate-set') {
    const [agent = '', model = '', effort = '', place = '', program, ...more] = parts;
    if (program === undefined || more.length > 0) return { kind: 'nothing' };
    return { kind, agent, model, effort, place, program };
  }
  const [first, second, third, ...more] = parts;
  if (first === undefined || first === '' || more.length > 0) return { kind: 'nothing' };
  if (second === undefined) {
    if (kind === 'open' || kind === 'restart' || kind === 'plugin-settings') {
      return { kind, name: first };
    }
    if (kind === 'logon' && (first === 'on' || first === 'off'))
      return { kind, on: first === 'on' };
    if (kind === 'place-remove') return { kind, name: first };
    if (kind === 'shelf-choose') return { kind, place: first };
    if (kind === 'mate-send' || kind === 'mate-ask') return { kind, text: first };
    if (kind === 'mate-link') return { kind, address: first };
    if (kind === 'mate-open' || kind === 'mate-delete') return { kind, id: first };
    if (kind === 'mate-copy' && /^\d{1,6}$/.test(first)) return { kind, message: Number(first) };
    if (kind === 'mate-width' && /^\d{1,5}$/.test(first)) return { kind, width: Number(first) };
  } else if (third === undefined) {
    if (kind === 'place-add') return { kind, name: first, placeKind: second };
    if (kind === 'shelf') return { kind, place: first, directory: second };
    if (kind === 'plugin-move') return { kind, name: first, position: second };
  } else if (kind === 'place-add') {
    return { kind, name: first, placeKind: second, distribution: third };
  }
  return { kind: 'nothing' };
}
