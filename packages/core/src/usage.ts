/**
 * Usage, as `/processes.json` says it, and the words every reader of it
 * prints a figure in: the command line now, and the Process View.
 *
 * It lives here and not in the Host because the command line reads what the
 * running Host says over loopback and carries no Host of its own (ADR-0024).
 * The Host reads Usage when asked and keeps none of it (ADR-0032).
 */
import type { PluginState } from './plugin-state.ts';

/** One row of Usage: FirstMate's own, or one Plugin's. */
export type UsageRow = {
  /** The Plugin Name, or `FirstMate` for FirstMate's own row, which no Plugin can be named. */
  readonly name: string;
  readonly state: PluginState;
  /** The Place the Plugin Server runs in. */
  readonly place: string;
  /**
   * The Plugin Server's own PID, in its Place: inside the distribution for a
   * `wsl` Place. Null when no Plugin Server runs.
   */
  readonly pid: number | null;
  /** How many processes the row counts: the Plugin Server and every one under it. */
  readonly processes: number | null;
  /** CPU since the last reading, against one core, as `top` counts it: it can pass 100. */
  readonly cpuPercent: number | null;
  /** The fair share of memory of every process the row counts, in bytes. */
  readonly memoryBytes: number | null;
  /** When the Plugin Server last started, as an ISO time. Null when none runs. */
  readonly startedAt: string | null;
  /** Why the Plugin is Stopped, as the Supervisor said it. Only when it is. */
  readonly why?: string;
  /** Why the reading failed, as a sentence. Only then, and the figures are null. */
  readonly unmeasured?: string;
};

/** What `/processes.json` answers: FirstMate's row, and one per Plugin in the Plugin Order. */
export type Processes = {
  readonly firstmate: UsageRow;
  readonly plugins: readonly UsageRow[];
};

/** The name of FirstMate's own row. It holds capitals, so no Plugin Name can be it. */
export const FIRSTMATE_ROW = 'FirstMate';

/**
 * A CPU figure, as `3.1%`. It and `memoryText` use nothing outside their own
 * body, because the Process View's page script runs their source as well.
 */
export function cpuText(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

/** A memory figure, as `58 MB`, or `1.25 GB` from 1024 MB up. */
export function memoryText(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(2)} GB` : `${Math.round(megabytes)} MB`;
}

/** How long since a start, as `42 s`, `7 min`, `3 h 12 min` or `2 d 5 h`. */
export function uptimeText(startedAt: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
