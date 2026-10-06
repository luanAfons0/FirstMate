/**
 * The Shortcuts: key combinations the App holds for all of Windows, each bound
 * from a terminal to one address of one Plugin (ADR-0013).
 *
 * The App reads them from `/shortcuts.json` when it starts and again after
 * every reload, so `firstmate bind` and `unbind` take effect with no restart.
 * It asks Windows for exactly those keys through Electron's `globalShortcut`,
 * which is `RegisterHotKey` underneath: the App gets the combinations it bound
 * and never sees any other key.
 *
 * Windows refuses keys another program already holds, and Electron then
 * answers false with no error. The App says so in a Notice, never in silence,
 * and does not ask for those keys again until they are bound again, so one
 * taken key is one sentence and not one per reload.
 */
import { app, globalShortcut } from 'electron';
import type { Shortcuts } from './host-lists.ts';

/** What the Shortcuts need from the rest of the App. */
export type ShortcutNeeds = {
  /** A Shortcut was pressed: open its address. */
  readonly pressed: (keys: string, address: string) => void;
  /** A Shortcut was unbound: put its Popup away if it is shown. */
  readonly released: (keys: string) => void;
  /** Say one sentence to the operator. */
  readonly say: (sentence: string) => void;
};

/** The keys the App holds, and the way to hold exactly the ones the Host names. */
export type HeldShortcuts = {
  /** Hold exactly these Shortcuts: ask for new keys, give back old ones. */
  hold(shortcuts: Shortcuts): void;
};

/**
 * A Shortcut's keys, in core's normal form, as Electron writes them. The
 * normal form says `Ctrl` and `Win` where Electron says `Control` and `Super`;
 * every other part, a letter, a digit, F1 to F24 or a named key, is written
 * the same way in both (`packages/core/src/shortcut.ts`).
 */
function accelerator(keys: string): string {
  return keys
    .split('+')
    .map((part) => (part === 'Ctrl' ? 'Control' : part === 'Win' ? 'Super' : part))
    .join('+');
}

/** Start holding no keys. */
export function holdShortcuts(needs: ShortcutNeeds): HeldShortcuts {
  /** Every key asked for, held or refused alike, by its normal form. */
  const asked = new Set<string>();
  /** What each key opens, as the Host last said. */
  let bound = new Map<string, string>();

  // Windows gives every key back when the App ends; this says so out loud.
  app.on('will-quit', () => globalShortcut.unregisterAll());

  return {
    hold(shortcuts) {
      // A Host that would not say has unbound nothing: the keys stay held.
      if (shortcuts.kind === 'untold') return;
      bound = new Map(shortcuts.shortcuts.map((shortcut) => [shortcut.keys, shortcut.address]));
      for (const keys of [...asked]) {
        if (bound.has(keys)) continue;
        asked.delete(keys);
        globalShortcut.unregister(accelerator(keys));
        needs.released(keys);
      }
      for (const keys of bound.keys()) {
        if (asked.has(keys)) continue;
        asked.add(keys);
        const refused = take(keys);
        if (refused !== undefined) needs.say(refused);
      }
    },
  };

  /** Ask Windows for one key combination, or say why it was not given. */
  function take(keys: string): string | undefined {
    let taken: boolean;
    try {
      taken = globalShortcut.register(accelerator(keys), () => {
        const address = bound.get(keys);
        if (address !== undefined) needs.pressed(keys, address);
      });
    } catch {
      // The settings were checked when they were read, so these are keys
      // core knows and Electron does not.
      return `FirstMate could not take ${keys}: Electron cannot read those keys.`;
    }
    return taken ? undefined : `FirstMate could not take ${keys}: another program holds them.`;
  }
}
