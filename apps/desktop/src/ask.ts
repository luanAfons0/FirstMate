/**
 * What one of the App's own views asks the main process for: the strip, the
 * switcher and the Settings View.
 *
 * Those views are pages the App writes, never pages the Host serves
 * (ADR-0008), and the one way they reach the main process is the preload that
 * only they carry. It hands the main process one string, and this reads it.
 * A Plugin Page has no preload, so it has no way to ask anything at all.
 *
 * The other way, the main process sends each of those views what it shows,
 * on its own channel, and the page puts it in place (`pages.ts`).
 *
 * This file imports nothing, because the preload carries it into a sandboxed
 * page, where Node's modules do not exist.
 */

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
  /** Close the switcher. */
  | { readonly kind: 'switcher-close' }
  /** Show one Plugin Page. */
  | { readonly kind: 'open'; readonly name: string }
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
  /** Nothing the App knows. Nothing happens. */
  | { readonly kind: 'nothing' };

/** The words each view says, for each thing that carries nothing with it. */
export const ASK = {
  pluginList: 'plugin-list',
  switcher: 'switcher',
  switcherClose: 'switcher-close',
  settings: 'settings',
} as const;

/** The words that ask to show one Plugin Page. */
export function openAsk(name: string): string {
  return said('open', name);
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
 * `shelf/<place>/<directory>` and `plugin-move/<name>/<position>`. The page
 * joins each part encoded.
 */
export const TYPED = { placeAdd: 'place-add', shelf: 'shelf', pluginMove: 'plugin-move' } as const;

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
  const [first, second, third, ...more] = parts;
  if (first === undefined || first === '' || more.length > 0) return { kind: 'nothing' };
  if (second === undefined) {
    if (kind === 'open') return { kind, name: first };
    if (kind === 'logon' && (first === 'on' || first === 'off'))
      return { kind, on: first === 'on' };
    if (kind === 'place-remove') return { kind, name: first };
    if (kind === 'shelf-choose') return { kind, place: first };
  } else if (third === undefined) {
    if (kind === 'place-add') return { kind, name: first, placeKind: second };
    if (kind === 'shelf') return { kind, place: first, directory: second };
    if (kind === 'plugin-move') return { kind, name: first, position: second };
  } else if (kind === 'place-add') {
    return { kind, name: first, placeKind: second, distribution: third };
  }
  return { kind: 'nothing' };
}
