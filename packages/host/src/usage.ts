/**
 * Usage: what FirstMate and each Plugin Server use of the machine, read when
 * the App or a terminal asks for `/processes.json`, and kept nowhere
 * (ADR-0032).
 *
 * Each Place is one source of processes, read by the reader of its kind: this
 * machine, or one WSL distribution, which is asked only while it holds a
 * running Plugin, so a reading never starts one. A row counts the processes
 * of its Plugin: the Plugin Server, every process under it, and every process
 * that names the Plugin in `FIRSTMATE_PLUGIN`. A source that fails says why in
 * the rows it holds, and the other rows still show.
 * CPU is the time a process used between two readings, so the Host holds the
 * last reading of each process in memory, and nothing else. With no reading
 * young enough, it reads twice, half a second apart, so one ask still gets a
 * CPU figure. It has no timer of its own (ADR-0004).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_PLACE } from '@firstmate/core/places';
import type { HeldPlugin } from '@firstmate/core/plugin-places';
import { FIRSTMATE_ROW, type Processes, type UsageRow } from '@firstmate/core/usage';
import { treeOf, type ProcessFacts, type ProcessReader } from './process-table.ts';
import type { RunFacts } from './supervisor.ts';
import { linuxReader } from './usage-linux.ts';
import { wslReader } from './usage-wsl.ts';
import { windowsReader } from './usage-windows.ts';

/** How old the last reading may be and still count CPU against: older, the Host reads twice. */
const FRESH_MS = 5_000;

/** The least time between two readings the Host counts CPU over. */
const SECOND_READING_MS = 500;

/** The source of this machine's processes. A distribution's is `wsl:<distribution>`. */
const LOCAL = 'local';

/**
 * The reader of this machine's processes, for each system FirstMate reads
 * Usage on. A system with none says so in each row of a local Plugin.
 */
const LOCAL_READERS: Partial<Record<NodeJS.Platform, (home: string | undefined) => ProcessReader>> =
  {
    linux: (home) => linuxReader(home),
    win32: () => windowsReader(),
  };

/** What the Host reads Usage from. */
export type UsageSources = {
  /** What the Supervisor knows of a Plugin's latest run. */
  readonly runOf: (name: string) => RunFacts | undefined;
  /** The PIDs FirstMate's own row counts: the Host's own process, unless the App says more. */
  readonly ownPids: () => readonly number[];
  /**
   * The `FIRSTMATE_HOME` the Host's Plugin Servers inherit, undefined for the
   * default home. A process that names a Plugin is this Host's only with it.
   */
  readonly home: string | undefined;
};

/** Usage, read when asked. */
export type Usage = {
  /** Read FirstMate's Usage and these Plugins', in the order given. */
  read(plugins: readonly HeldPlugin[]): Promise<Processes>;
  /** End what the readers keep open between readings, as the Host stops. */
  close(): Promise<void>;
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
  const local = LOCAL_READERS[process.platform]?.(sources.home);
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
    const running = runs.flatMap(({ run }) => (isRunning(run) ? [run] : []));
    const ownPids = sources.ownPids();
    const roots = [
      ...ownPids,
      ...running.flatMap((run) => (isLocal(run) && run.pid !== null ? [run.pid] : [])),
    ];
    const distributions = new Map<string, string>();
    for (const { plugin } of running) {
      if (plugin.runner.kind === 'wsl') {
        distributions.set(sourceOf(plugin), plugin.runner.distribution);
      }
    }
    // A source no longer read keeps no reading: a distribution that holds
    // no running Plugin is not asked, and its processes are forgotten.
    for (const key of last.keys()) {
      if (key !== LOCAL && !distributions.has(key)) last.delete(key);
    }
    const readings = new Map<string, Measured>(
      await Promise.all([
        (async (): Promise<[string, Measured]> => [
          LOCAL,
          local === undefined
            ? { kind: 'unmeasured', why: `FirstMate reads no Usage on ${process.platform} yet.` }
            : await measure(LOCAL, local, roots),
        ])(),
        ...[...distributions].map(async ([key, distribution]): Promise<[string, Measured]> => [
          key,
          // Inside a distribution the Plugin Servers are found by
          // FIRSTMATE_PLUGIN, so no PID of this machine is a root there.
          await measure(key, wslReader(distribution, sources.home), []),
        ]),
      ]),
    );
    const here = readings.get(LOCAL) ?? NOT_READ;

    const firstmate: UsageRow = {
      name: FIRSTMATE_ROW,
      state: 'running',
      place: DEFAULT_PLACE,
      pid: process.pid,
      startedAt: ownStart,
      ...counted(here, { kind: 'own', pids: ownPids }),
    };
    return {
      firstmate,
      plugins: runs.map(({ plugin, run }) =>
        pluginRow(plugin, run, readings.get(sourceOf(plugin)) ?? NOT_READ),
      ),
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
    async close() {
      await local?.close?.();
    },
  };
}

/** A Place that was not read, because it holds no running Plugin, whose row has no figures anyway. */
const NOT_READ: Measured = { kind: 'unmeasured', why: 'its Place was not read.' };

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
  if (!isRunning(run) || run.pid === null) {
    return state === 'stopped' && run !== undefined && run.why !== null
      ? { ...idle, why: run.why }
      : idle;
  }
  const startedAt = run.startedAt === null ? null : new Date(run.startedAt).toISOString();
  // In a wsl Place run.pid is wsl.exe's, on this machine, and would name the
  // wrong process: the Plugin Server's own PID is inside its distribution.
  const local = isLocal(run);
  if (here.kind === 'unmeasured') {
    return { ...idle, pid: local ? run.pid : null, startedAt, ...unmeasured(here.why) };
  }
  const pid = local ? run.pid : serverIn(here.table, plugin.name);
  const row = { ...idle, pid, startedAt };
  if (pid === null) {
    return { ...row, unmeasured: 'its Plugin Server is not in the process table of its Place.' };
  }
  if (!here.table.some((one) => one.pid === pid)) {
    return { ...row, unmeasured: `its Plugin Server, PID ${pid}, is not in the process table.` };
  }
  return { ...row, ...counted(here, { kind: 'plugin', name: plugin.name, server: pid }) };
}

/**
 * The Plugin Server among the processes that name this Plugin: of those whose
 * parent does not name it, the first started, as a child that left its
 * parent started after it. Null when no process names it.
 */
function serverIn(table: readonly ProcessFacts[], plugin: string): number | null {
  const named = table.filter((one) => one.plugin === plugin);
  const pids = new Set(named.map((one) => one.pid));
  const [first] = named
    .filter((one) => !pids.has(one.parent))
    .sort((one, other) => one.start - other.start || one.pid - other.pid);
  return first?.pid ?? null;
}

/** Whose processes a row counts. */
type Counting =
  /**
   * FirstMate's own row: these processes alone, and no tree under them,
   * because everything under the Host is a Plugin Server, with a row of its own.
   */
  | { readonly kind: 'own'; readonly pids: readonly number[] }
  /** A Plugin's: its Plugin Server, every process under it, and every one that names it. */
  | { readonly kind: 'plugin'; readonly name: string; readonly server: number };

/** The figures of a row, and why there are none when its Place was not measured. */
type Figures = Pick<UsageRow, 'processes' | 'cpuPercent' | 'memoryBytes' | 'unmeasured'>;

/** The figures of a row whose reading failed: none, and why. */
function unmeasured(why: string): Figures {
  return { processes: null, cpuPercent: null, memoryBytes: null, unmeasured: why };
}

/** The figures of a row: the processes it counts, their CPU and their memory. */
function counted(here: Measured, counting: Counting): Figures {
  if (here.kind === 'unmeasured') return unmeasured(here.why);
  const mine =
    counting.kind === 'own'
      ? here.table.filter((one) => counting.pids.includes(one.pid))
      : pluginsOwn(here.table, counting.name, counting.server);
  const cpu = mine.reduce((sum, one) => sum + here.cpu(one), 0);
  return {
    processes: mine.length,
    cpuPercent: Math.round(cpu * 1000) / 10,
    memoryBytes: mine.reduce((sum, one) => sum + (one.memoryBytes ?? 0), 0),
  };
}

/** A Plugin's processes: its Plugin Server, every one under it, and every one that names it. */
function pluginsOwn(
  table: readonly ProcessFacts[],
  name: string,
  server: number,
): readonly ProcessFacts[] {
  const tree = treeOf(table, [server]);
  return table.filter((one) => tree.has(one.pid) || one.plugin === name);
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

/** Whether a run's Plugin Server is up, so that its Place is read. */
function isRunning(run: RunFacts | undefined): run is RunFacts {
  return run?.state === 'running';
}

/** The source a Plugin's processes are read from: this machine, or its distribution. */
function sourceOf(plugin: HeldPlugin): string {
  return plugin.runner.kind === 'wsl' ? `wsl:${plugin.runner.distribution}` : LOCAL;
}

function sentence(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}
