/**
 * What the Host says about its Plugins, their Usage and its Shortcuts, as the
 * App reads it.
 *
 * The App asks `/plugins.json`, `/processes.json` and `/shortcuts.json` over
 * loopback, the addresses the 1.x Tray asked, rather than reaching into the
 * Host it holds. The Host then has one surface, and the strip, the switcher,
 * the Process View, the Tray and the Shortcuts all see what a terminal sees.
 */
import type { PluginState } from '@firstmate/core/plugin-state';
import type { Processes, UsageRow } from '@firstmate/core/usage';
import { admitted, type HostAt } from './addresses.ts';

/** How long the App waits for the Host it holds to answer. */
const ASK_TIMEOUT_MS = 5_000;

/**
 * How long the App waits for `/processes.json`. More than the other asks:
 * the first reading on Windows starts a PowerShell and reads twice, and the
 * Host gives each answer of that PowerShell up to 10 seconds of its own, so
 * this is above what the Host waits (ADR-0032).
 */
const PROCESSES_TIMEOUT_MS = 25_000;

/** How long the App waits for a Plugin Server to start again. */
const RESTART_TIMEOUT_MS = 30_000;

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

/**
 * How many Plugins are Stopped, which the strip and the Tray both show. A
 * Host that would not say names none.
 */
export function stoppedCount(plugins: Plugins | undefined): number {
  return plugins?.kind === 'told'
    ? plugins.plugins.filter((plugin) => plugin.state === 'stopped').length
    : 0;
}

const STATES: ReadonlySet<string> = new Set(['running', 'stopped', 'no-plugin-server']);

/** Every Plugin the Host names, in the Plugin Order, or the fact that it would not say. */
export async function askForPlugins(host: HostAt): Promise<Plugins> {
  const said = await askFor(host, '/plugins.json');
  if (typeof said !== 'object' || said === null || !('plugins' in said)) return { kind: 'untold' };
  const rows = said.plugins;
  if (!Array.isArray(rows)) return { kind: 'untold' };
  return { kind: 'told', plugins: rows.flatMap(onePlugin) };
}

/**
 * Start one Plugin's Plugin Server again, through `POST /restart/<name>`, the
 * address `firstmate restart` reaches. Resolves to a sentence when it failed,
 * and to nothing when it worked. Node's fetch sends no Origin, as the Host
 * wants of a terminal.
 */
export async function askToRestart(host: HostAt, name: string): Promise<string | undefined> {
  try {
    const answer = await fetch(admitted(host, `/restart/${encodeURIComponent(name)}`), {
      method: 'POST',
      signal: AbortSignal.timeout(RESTART_TIMEOUT_MS),
    });
    return answer.ok ? undefined : await answer.text();
  } catch (fault: unknown) {
    const why = fault instanceof Error ? fault.message : String(fault);
    return `The Host did not answer the restart of ${name}: ${why}`;
  }
}

/**
 * What the Host said about Usage: FirstMate's row and one per Plugin, or the
 * fact that it would not say.
 */
export type ProcessesAnswer =
  { readonly kind: 'told'; readonly processes: Processes } | { readonly kind: 'untold' };

/**
 * The Usage of FirstMate and of every Plugin, in the Plugin Order, read from
 * `/processes.json`. Node's fetch sends no Origin, as the Host wants of the
 * App and a terminal (ADR-0032). A row that cannot be read is left out; a
 * FirstMate row that cannot be read is a Host that would not say.
 */
export async function askForProcesses(host: HostAt): Promise<ProcessesAnswer> {
  const said = await askFor(host, '/processes.json', PROCESSES_TIMEOUT_MS);
  if (typeof said !== 'object' || said === null) return { kind: 'untold' };
  const { firstmate, plugins } = said as Record<string, unknown>;
  const [own] = usageRow(firstmate);
  if (own === undefined || !Array.isArray(plugins)) return { kind: 'untold' };
  return { kind: 'told', processes: { firstmate: own, plugins: plugins.flatMap(usageRow) } };
}

/** A figure, which is a number or null when there is none. */
const isFigure = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

function usageRow(row: unknown): readonly UsageRow[] {
  if (typeof row !== 'object' || row === null) return [];
  const {
    name,
    state,
    place,
    pid,
    processes,
    cpuPercent,
    memoryBytes,
    startedAt,
    why,
    unmeasured,
  } = row as Record<string, unknown>;
  if (typeof name !== 'string' || typeof place !== 'string') return [];
  if (typeof state !== 'string' || !STATES.has(state)) return [];
  if (![pid, processes, cpuPercent, memoryBytes].every(isFigure)) return [];
  if (startedAt !== null && typeof startedAt !== 'string') return [];
  return [
    {
      name,
      state: state as PluginState,
      place,
      pid: pid as number | null,
      processes: processes as number | null,
      cpuPercent: cpuPercent as number | null,
      memoryBytes: memoryBytes as number | null,
      startedAt,
      ...(typeof why === 'string' ? { why } : {}),
      ...(typeof unmeasured === 'string' ? { unmeasured } : {}),
    },
  ];
}

/** One Shortcut, as the Host says it: the keys, and the address they open. */
type ShortcutSeen = {
  /** The keys, in core's normal form, such as `Ctrl+Alt+N`. */
  readonly keys: string;
  /** The path on the Host a press opens, such as `/p/worklog/new.html`. */
  readonly address: string;
};

/**
 * What the Host said about the Shortcuts. A Host that would not say has not
 * unbound anything, so "untold" changes nothing that is held.
 */
export type Shortcuts =
  | { readonly kind: 'told'; readonly shortcuts: readonly ShortcutSeen[] }
  | { readonly kind: 'untold' };

/** Every Shortcut in the settings, or the fact that the Host would not say. */
export async function askForShortcuts(host: HostAt): Promise<Shortcuts> {
  const said = await askFor(host, '/shortcuts.json');
  if (typeof said !== 'object' || said === null || !('shortcuts' in said)) {
    return { kind: 'untold' };
  }
  const rows = said.shortcuts;
  if (!Array.isArray(rows)) return { kind: 'untold' };
  return { kind: 'told', shortcuts: rows.flatMap(oneShortcut) };
}

function oneShortcut(row: unknown): readonly ShortcutSeen[] {
  if (typeof row !== 'object' || row === null) return [];
  const { keys, address } = row as Record<string, unknown>;
  if (typeof keys !== 'string' || typeof address !== 'string') return [];
  // Only an address under a Plugin's own is opened, whatever the answer says.
  if (!address.startsWith('/p/')) return [];
  return [{ keys, address }];
}

/** What the Host answers at one address, read as JSON, or undefined when it does not. */
async function askFor(host: HostAt, path: string, timeoutMs = ASK_TIMEOUT_MS): Promise<unknown> {
  try {
    const answer = await fetch(admitted(host, path), {
      signal: AbortSignal.timeout(timeoutMs),
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
