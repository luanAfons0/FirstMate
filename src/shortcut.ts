/**
 * A Shortcut: a key combination the Tray holds for all of Windows, bound from
 * a terminal to one address of one Plugin (ADR-0013).
 *
 * The keys are read here and nowhere else, so the command line that writes a
 * Shortcut and the Tray that registers it agree on what `Ctrl+Alt+N` means.
 * Letter case and modifier order do not matter to a person, so they do not
 * matter here either: every Shortcut is kept in one normal form, and two
 * Shortcuts are the same Shortcut when their normal forms are equal.
 *
 * This module imports nothing native and nothing from the Host, because the
 * Tray runs it on Windows.
 */

/** A Shortcut as the settings file holds it. */
export type Shortcut = {
  /** The keys, in normal form: `Ctrl+Alt+N`. */
  readonly keys: string;
  /** The Plugin Name whose address it opens. */
  readonly plugin: string;
  /** The path under the Plugin's address. Empty opens the Plugin Page. */
  readonly path: string;
};

/** What Windows needs to register a Shortcut: modifier flags and one key code. */
export type KeyChord = {
  /** The keys, in normal form. */
  readonly keys: string;
  /** `MOD_ALT`, `MOD_CONTROL`, `MOD_SHIFT` and `MOD_WIN`, or-ed together. */
  readonly modifiers: number;
  /** The Windows virtual-key code of the one key. */
  readonly key: number;
};

/** The keys, read, or the sentence that says which part is wrong. */
export type KeysRead =
  | { readonly kind: 'keys'; readonly chord: KeyChord }
  | { readonly kind: 'wrong'; readonly reason: string };

/**
 * The modifiers, in the order the normal form writes them, with the flag
 * `RegisterHotKey` takes for each.
 */
const MODIFIERS: readonly (readonly [string, number])[] = [
  ['Ctrl', 0x0002],
  ['Alt', 0x0001],
  ['Shift', 0x0004],
  ['Win', 0x0008],
];

/**
 * The named keys a Shortcut may end in, with their virtual-key codes. The set
 * is small on purpose: a key that is not here is refused rather than guessed.
 */
const NAMED_KEYS: readonly (readonly [string, number])[] = [
  ['Space', 0x20],
  ['Enter', 0x0d],
  ['Tab', 0x09],
  ['Backspace', 0x08],
  ['Insert', 0x2d],
  ['Delete', 0x2e],
  ['Home', 0x24],
  ['End', 0x23],
  ['PageUp', 0x21],
  ['PageDown', 0x22],
  ['Up', 0x26],
  ['Down', 0x28],
  ['Left', 0x25],
  ['Right', 0x27],
];

/**
 * Read the keys a person typed: one or more modifiers and exactly one key,
 * joined by `+`, in any letter case and any modifier order.
 */
export function readKeys(typed: string): KeysRead {
  const parts = typed.split('+').map((part) => part.trim());
  if (parts.some((part) => part === '')) {
    return wrong(`${typed} has an empty part. Join the keys with one +, as in Ctrl+Alt+N.`);
  }

  let modifiers = 0;
  let key: readonly [string, number] | undefined;
  for (const part of parts) {
    const modifier = MODIFIERS.find(([name]) => same(name, part));
    if (modifier !== undefined) {
      if ((modifiers & modifier[1]) !== 0) {
        return wrong(`${typed} names ${modifier[0]} twice.`);
      }
      modifiers |= modifier[1];
      continue;
    }
    const found = readKey(part);
    if (found === undefined) {
      return wrong(
        `${part} in ${typed} is not a key FirstMate knows. Use Ctrl, Alt, Shift or Win, ` +
          `then one letter, digit, F1 to F24, or ${NAMED_KEYS.map(([name]) => name).join(', ')}.`,
      );
    }
    if (key !== undefined) {
      return wrong(`${typed} names two keys, ${key[0]} and ${found[0]}. A Shortcut has one.`);
    }
    key = found;
  }

  if (key === undefined) {
    return wrong(`${typed} has no key, only modifiers. End it with one key, as in Ctrl+Alt+N.`);
  }
  if (modifiers === 0) {
    return wrong(
      `${typed} has no modifier. A Shortcut holds a key in all of Windows, so it needs ` +
        'Ctrl, Alt, Shift or Win.',
    );
  }

  const names = MODIFIERS.filter(([, flag]) => (modifiers & flag) !== 0).map(([name]) => name);
  return { kind: 'keys', chord: { keys: [...names, key[0]].join('+'), modifiers, key: key[1] } };
}

/** The keys in normal form, or undefined when they are not keys at all. */
export function normalKeys(typed: string): string | undefined {
  const read = readKeys(typed);
  return read.kind === 'keys' ? read.chord.keys : undefined;
}

/**
 * Whether a path stays inside its Plugin's address. It is relative, it has no
 * `..`, and resolving it under `/p/<plugin>/` still lands there, so a Shortcut
 * never opens anything but its own Plugin.
 */
export function isPluginPath(path: string, plugin: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || path.includes(':')) return false;
  if (path.split(/[/?#]/).some((segment) => segment === '..')) return false;
  const base = `http://firstmate.invalid${pluginAddress(plugin, '')}`;
  const resolved = new URL(path, base);
  return resolved.origin === 'http://firstmate.invalid' && resolved.href.startsWith(base);
}

/** The address a Shortcut opens, on the Host. */
export function shortcutAddress(shortcut: Shortcut): string {
  return pluginAddress(shortcut.plugin, shortcut.path);
}

function pluginAddress(plugin: string, path: string): string {
  return `/p/${encodeURIComponent(plugin)}/${path}`;
}

function readKey(part: string): readonly [string, number] | undefined {
  if (/^[a-z]$/i.test(part)) {
    const letter = part.toUpperCase();
    return [letter, letter.charCodeAt(0)];
  }
  if (/^[0-9]$/.test(part)) return [part, part.charCodeAt(0)];
  const f = /^f([0-9]{1,2})$/i.exec(part);
  if (f !== null) {
    const number = Number(f[1]);
    if (number >= 1 && number <= 24 && String(number) === f[1]) {
      return [`F${number}`, 0x70 + number - 1];
    }
    return undefined;
  }
  return NAMED_KEYS.find(([name]) => same(name, part));
}

function same(name: string, part: string): boolean {
  return name.toLowerCase() === part.toLowerCase();
}

function wrong(reason: string): KeysRead {
  return { kind: 'wrong', reason };
}
