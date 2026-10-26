/**
 * Usage: what FirstMate and each Plugin Server use of the machine, read when
 * the App or a terminal asks for `/processes.json`, and kept nowhere
 * (ADR-0032).
 *
 * Each Place is one source of processes, read by the reader of its kind. A
 * row counts the processes of its Plugin: the Plugin Server, every process
 * under it, and every process that names the Plugin in `FIRSTMATE_PLUGIN`.
 * CPU is the time a process used between two readings, so the Host holds the
 * last reading of each process in memory, and nothing else. With no reading
 * young enough, it reads twice, half a second apart, so one ask still gets a
 * CPU figure. It has no timer of its own (ADR-0004).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { HOME_VARIABLE } from '@firstmate/core/config';
import { DEFAULT_PLACE } from '@firstmate/core/places';
import type { HeldPlugin } from '@firstmate/core/plugin-places';
import { FIRSTMATE_ROW, type Processes, type UsageRow } from '@firstmate/core/usage';
import { treeOf, type ProcessFacts, type ProcessReader } from './process-table.ts';
import type { RunFacts } from './supervisor.ts';
import { linuxReader } from './usage-linux.ts';

/** How old the last reading may be and still count CPU against: older, the Host reads twice. */
const FRESH_MS = 5_000;

/** The least time between two readings the Host counts CPU over. */
const SECOND_READING_MS = 500;

/**
 * The reader of this machine's processes, for each system FirstMate reads
 * Usage on. A system with none says so in each row of a local Plugin.
 */
const LOCAL_READERS: Partial<Record<NodeJS.Platform, () => ProcessReader>> = {
  linux: () => linuxReader(process.env[HOME_VARIABLE]),
};

/** What the Host reads Usage from. */
export type UsageSources = {
  /** What the Supervisor knows of a Plugin's latest run. */
  readonly runOf: (name: string) => RunFacts | undefined;
  /** The PIDs FirstMate's own row counts: the Host's own process, unless the App says more. */
  readonly ownPids: () => readonly number[];
};

/** Usage, read when asked. */
export type Usage = {
  /** Read FirstMate's Usage and these Plugins', in the order given. */
  read(plugins: readonly HeldPlugin[]): Promise<Processes>;
};

/** One reading of one source: when it was taken, and every process's CPU time then. */
type Reading = {
  /** When the reading began, on the monotonic clock, in milliseconds. */
  readonly at: number;
  /** The CPU time of each process, in milliseconds, by `pid@start`. */
  readonly cpuMs: ReadonlyMap<string, number>;
};

/** One source read for one ask: its table, and each process's CPU over the time between. */
type Measured =
  | {
      readonly kind: 'read';
      readonly table: readonly ProcessFacts[];
      cpu(of: ProcessFacts): number;
    }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** Open Usage over the Supervisor's runs. Nothing is read until it is asked. */
export function openUsage(sources: UsageSources): Usage {
  const local = LOCAL_READERS[process.platform]?.();
  // The process's own start, in the App and in a bare Host alike.
  const ownStart = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const last = new Map<string, Reading>();

  const measure = async (
    key: string,
    reader: ProcessReader,
    roots: readonly number[],
  ): Promise<Measured> => {
    try {
      let before = last.get(key);
      if (before === undefined || performance.now() - before.at > FRESH_MS) {
        before = (await take(reader, roots)).reading;
      }
      // CPU over a few milliseconds is mostly the reading itself, so two
      // readings are always half a second apart at least.
      const early = before.at + SECOND_READING_MS - performance.now();
      if (early > 0) await delay(early);
      const { table, reading } = await take(reader, roots);
      // The reading replaces the last one whole, so a process that ended is
      // forgotten with it.
      last.set(key, reading);
      const span = reading.at - before.at;
      const earlier = before.cpuMs;
      return {
        kind: 'read',
        table,
        // A process the earlier reading did not hold started since, so all of
        // its time falls between the two.
        cpu: (of) => Math.max(0, of.cpuMs - (earlier.get(keyOf(of)) ?? 0)) / span,
      };
    } catch (fault: unknown) {
      last.delete(key);
      return { kind: 'unmeasured', why: sentence(fault) };
    }
  };

  const readAll = async (plugins: readonly HeldPlugin[]): Promise<Processes> => {
    const runs = plugins.map((plugin) => ({ plugin, run: sources.runOf(plugin.name) }));
    const ownPids = sources.ownPids();
    const roots = [
      ...ownPids,
      ...runs.flatMap(({ run }) => (isLocal(run) && run.pid !== null ? [run.pid] : [])),
    ];
    const here: Measured =
      local === undefined
        ? { kind: 'unmeasured', why: `FirstMate reads no Usage on ${process.platform} yet.` }
        : await measure('local', local, roots);

    const firstmate: UsageRow = {
      name: FIRSTMATE_ROW,
      state: 'running',
      place: DEFAULT_PLACE,
      pid: process.pid,
      startedAt: ownStart,
      ...counted(here, ownPids, null),
    };
    return {
      firstmate,
      plugins: runs.map(({ plugin, run }) => pluginRow(plugin, run, here)),
    };
  };

  // Two asks that cross share one reading, so neither counts CPU over the
  // few milliseconds between them.
  let reading: Promise<Processes> | undefined;
  return {
    read(plugins) {
      reading ??= readAll(plugins).finally(() => {
        reading = undefined;
      });
      return reading;
    },
  };
}

/** One Plugin's row, from its run and the reading of its Place. */
function pluginRow(plugin: HeldPlugin, run: RunFacts | undefined, here: Measured): UsageRow {
  const state = run?.state ?? 'stopped';
  const idle: UsageRow = {
    name: plugin.name,
    state,
    place: plugin.place,
    pid: null,
    processes: null,
    cpuPercent: null,
    memoryBytes: null,
    startedAt: null,
  };
  if (run === undefined || state !== 'running' || run.pid === null) {
    return state === 'stopped' && run !== undefined && run.why !== null
      ? { ...idle, why: run.why }
      : idle;
  }
  const startedAt = run.startedAt === null ? null : new Date(run.startedAt).toISOString();
  if (!isLocal(run)) {
    // A wsl Plugin Server's own PID is inside its distribution, which no
    // reader asks yet; wsl.exe's PID here would name the wrong process.
    return { ...idle, startedAt, unmeasured: 'FirstMate reads no Usage in a wsl Place yet.' };
  }
  const row = { ...idle, pid: run.pid, startedAt };
  if (here.kind === 'read' && !here.table.some((one) => one.pid === run.pid)) {
    return {
      ...row,
      unmeasured: `its Plugin Server, PID ${run.pid}, is not in the process table.`,
    };
  }
  return { ...row, ...counted(here, [run.pid], plugin.name) };
}

/** The figures of a row: the processes it counts, their CPU and their memory. */
function counted(
  here: Measured,
  roots: readonly number[],
  plugin: string | null,
): Pick<UsageRow, 'processes' | 'cpuPercent' | 'memoryBytes' | 'unmeasured'> {
  if (here.kind === 'unmeasured') {
    return { processes: null, cpuPercent: null, memoryBytes: null, unmeasured: here.why };
  }
  // FirstMate's own row counts its own processes alone: everything under the
  // Host is a Plugin Server, which has a row of its own.
  const pids = plugin === null ? new Set(roots) : treeOf(here.table, roots);
  const mine = here.table.filter(
    (one) => pids.has(one.pid) || (plugin !== null && one.plugin === plugin),
  );
  const cpu = mine.reduce((sum, one) => sum + here.cpu(one), 0);
  return {
    processes: mine.length,
    cpuPercent: Math.round(cpu * 1000) / 10,
    memoryBytes: mine.reduce((sum, one) => sum + (one.memoryBytes ?? 0), 0),
  };
}

/** Read a source once, and note when, and what each process had used by then. */
async function take(
  reader: ProcessReader,
  roots: readonly number[],
): Promise<{ readonly table: readonly ProcessFacts[]; readonly reading: Reading }> {
  const at = performance.now();
  const table = await reader.read(roots);
  return { table, reading: { at, cpuMs: new Map(table.map((one) => [keyOf(one), one.cpuMs])) } };
}

/** One process, so that a PID the system gave again is not taken for the old one. */
function keyOf(one: ProcessFacts): string {
  return `${one.pid}@${one.start}`;
}

/** Whether a run's Plugin Server is a process of this machine. */
function isLocal(run: RunFacts | undefined): run is RunFacts {
  return run?.plugin.runner.kind === 'local';
}

function sentence(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}
