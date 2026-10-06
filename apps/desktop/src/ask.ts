/**
 * What one of the App's own views asks the main process for: the strip, the
 * switcher and the Settings View.
 *
 * Those views are pages the App writes, never pages the Host serves
 * (ADR-0008), and the one way they reach the main process is the preload that
 * only they carry. It hands the main process one string, and this reads it.
 * A Plugin Page has no preload, so it has no way to ask anything at all.
 *
 * This file imports nothing, because the preload carries it into a sandboxed
 * page, where Node's modules do not exist.
 */

/** The IPC channel an App view asks on. */
export const ASK_CHANNEL = 'firstmate:ask';

/** What an App view asked for. */
export type Asked =
  /** Show the Index Page. */
  | { readonly kind: 'plugin-list' }
  /** Give what the window shows to the system browser. */
  | { readonly kind: 'open-in-browser' }
  /** Open the switcher, or close it when it is open. */
  | { readonly kind: 'switcher' }
  /** Close the switcher. */
  | { readonly kind: 'switcher-close' }
  /** Show one Plugin Page. */
  | { readonly kind: 'open'; readonly name: string }
  /** Open the Settings View, or close it when it is open. */
  | { readonly kind: 'settings' }
  /** Nothing the App knows. Nothing happens. */
  | { readonly kind: 'nothing' };

/** The words each view says, for each thing that carries nothing with it. */
export const ASK = {
  pluginList: 'plugin-list',
  openInBrowser: 'open-in-browser',
  switcher: 'switcher',
  switcherClose: 'switcher-close',
  settings: 'settings',
} as const;

/** The words that ask to show one Plugin Page. */
export function openAsk(name: string): string {
  return `open/${encodeURIComponent(name)}`;
}

/**
 * What a view asked for. It never throws: what it cannot read asks for
 * nothing. A Plugin Name is handed on as it was asked for, and the main
 * process opens it only when the Host named it.
 */
export function readAsked(said: unknown): Asked {
  if (typeof said !== 'string') return { kind: 'nothing' };
  for (const kind of Object.values(ASK)) {
    if (said === kind) return { kind };
  }
  const open = /^open\/([^/]+)$/.exec(said);
  if (open?.[1] === undefined) return { kind: 'nothing' };
  try {
    return { kind: 'open', name: decodeURIComponent(open[1]) };
  } catch {
    return { kind: 'nothing' };
  }
}
