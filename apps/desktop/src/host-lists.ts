/**
 * What the Host says about its Plugins, as the App reads it.
 *
 * The App asks `/plugins.json` over loopback, the address the 1.x Tray asked,
 * rather than reaching into the Host it holds. The Host then has one surface,
 * and the strip, the switcher and the Tray all see what a browser sees.
 */
import type { PluginState } from '@firstmate/core/plugin-state';
import { admitted, type HostAt } from './addresses.ts';

/** How long the App waits for the Host it holds to answer. */
const ASK_TIMEOUT_MS = 5_000;

/** What the Host says about one Plugin. */
export type PluginSeen = {
  /** The Plugin Name, which is also its address. */
  readonly name: string;
  /** Whether it ships a Plugin Page, so whether there is anything to open. */
  readonly hasPage: boolean;
  /** What the Host knows about its Plugin Server now. */
  readonly state: PluginState;
};

/**
 * What the Host said about its Plugins. "The Host would not say" and "no
 * Plugin is registered" are two shapes, never one empty list, because they
 * are different states with different words (#44).
 */
export type Plugins =
  { readonly kind: 'told'; readonly plugins: readonly PluginSeen[] } | { readonly kind: 'untold' };

const STATES: ReadonlySet<string> = new Set(['running', 'stopped', 'no-plugin-server']);

/** Every Plugin the Host names, in the Plugin Order, or the fact that it would not say. */
export async function askForPlugins(host: HostAt): Promise<Plugins> {
  const said = await askFor(host, '/plugins.json');
  if (typeof said !== 'object' || said === null || !('plugins' in said)) return { kind: 'untold' };
  const rows = said.plugins;
  if (!Array.isArray(rows)) return { kind: 'untold' };
  return { kind: 'told', plugins: rows.flatMap(onePlugin) };
}

/** What the Host answers at one address, read as JSON, or undefined when it does not. */
async function askFor(host: HostAt, path: string): Promise<unknown> {
  try {
    const answer = await fetch(admitted(host, path), {
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    if (!answer.ok) {
      // The Host says why in one sentence, such as a damaged settings file.
      console.error(`FirstMate: the Host would not say ${path}: ${await answer.text()}`);
      return undefined;
    }
    return await answer.json();
  } catch (fault: unknown) {
    console.error(`FirstMate: the Host did not answer ${path}.`, fault);
    return undefined;
  }
}

function onePlugin(row: unknown): readonly PluginSeen[] {
  if (typeof row !== 'object' || row === null) return [];
  const { name, hasPage, state } = row as Record<string, unknown>;
  if (typeof name !== 'string' || typeof hasPage !== 'boolean') return [];
  if (typeof state !== 'string' || !STATES.has(state)) return [];
  return [{ name, hasPage, state: state as PluginState }];
}
