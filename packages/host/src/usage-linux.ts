/**
 * Usage on Linux: every process in `/proc`, read as text, with no program
 * started and no dependency (ADR-0032).
 *
 * CPU is user plus system time from each process's `stat`, which Linux counts
 * in ticks of 1/100 s. Memory is PSS from `smaps_rollup`: each page shared by
 * several processes is split between them, so Plugins that share one Node do
 * not each look as big as all of it. A process says which Plugin it belongs to
 * by the `FIRSTMATE_PLUGIN` in its environment, which every process under a
 * Plugin Server inherits, so a child that left its parent is still found.
 */
import { readdir, readFile } from 'node:fs/promises';
import { HOME_VARIABLE } from '@firstmate/core/config';
import { treeOf, type ProcessFacts, type ProcessReader } from './process-table.ts';

/** Where Linux shows its processes. */
const PROC = '/proc';

/** How long one tick of `stat` is: Linux counts CPU time in hundredths of a second. */
const TICK_MS = 10;

/** The variable that names a process's Plugin, which the Supervisor sets (ADR-0032). */
const PLUGIN_MARK = 'FIRSTMATE_PLUGIN=';

/** The variable that names a process's Host by its home. */
const HOME_MARK = `${HOME_VARIABLE}=`;

/** One process before its memory is read. */
type Seen = Omit<ProcessFacts, 'memoryBytes'>;

/** What a process's `stat` says of it. */
type Stat = Omit<Seen, 'plugin'>;

/**
 * Whether a process that names a Plugin is this Host's, by the
 * `FIRSTMATE_HOME` its environment holds, or undefined when it holds none.
 */
export type OwnHome = (home: string | undefined) => boolean;

/**
 * The reader of this machine's `/proc`. A process is this Host's only when it
 * carries the Host's own home, so a second Host on the same machine, a test's
 * or a developer's, never adds its Plugins to this one's.
 */
export function linuxReader(home: string | undefined): ProcessReader {
  const ownHome: OwnHome = (named) => named === home;
  return {
    async read(roots) {
      const pids = (await readdir(PROC)).filter((name) => /^\d+$/.test(name)).map(Number);
      const seen = (await Promise.all(pids.map((pid) => readProcess(pid, ownHome)))).filter(
        (one): one is Seen => one !== null,
      );
      const wanted = treeOf(
        seen.map((one) => ({ ...one, memoryBytes: null })),
        roots,
      );
      for (const one of seen) if (one.plugin !== null) wanted.add(one.pid);
      return Promise.all(
        seen.map(async (one) => ({
          ...one,
          memoryBytes: wanted.has(one.pid) ? await readPss(one.pid) : null,
        })),
      );
    },
  };
}

/** One process, or null when it ended while the table was read. */
async function readProcess(pid: number, ownHome: OwnHome): Promise<Seen | null> {
  const text = await readFile(`${PROC}/${pid}/stat`, 'utf8').catch(() => null);
  const stat = text === null ? null : statOf(text);
  if (stat === null) return null;
  // Another user's environment cannot be read, and no Plugin of this Host is
  // another user's.
  const environment = await readFile(`${PROC}/${pid}/environ`, 'latin1').catch(() => '');
  return { ...stat, plugin: pluginOf(environment, ownHome) };
}

/** A process's `stat`, as proc(5) writes it, or null when it is not whole. */
export function statOf(text: string): Stat | null {
  // The name in brackets may hold spaces and brackets of its own, so the
  // fields are counted from the last one.
  const close = text.lastIndexOf(')');
  if (close === -1) return null;
  const pid = Number.parseInt(text, 10);
  const fields = text.slice(close + 2).split(' ');
  // Fields 4, 14, 15 and 22 of proc(5), counted from field 3 here.
  const parent = Number(fields[1]);
  const ticks = Number(fields[11]) + Number(fields[12]);
  const start = Number(fields[19]);
  if (![pid, parent, ticks, start].every(Number.isFinite)) return null;
  return { pid, parent, start, cpuMs: ticks * TICK_MS };
}

/**
 * The Plugin a process's environment names, when the process is this
 * Host's. The variables are split by NUL, as `environ` holds them.
 */
export function pluginOf(environment: string, ownHome: OwnHome): string | null {
  const variables = environment.split('\0');
  const named = variables.find((variable) => variable.startsWith(PLUGIN_MARK));
  if (named === undefined) return null;
  const home = variables.find((variable) => variable.startsWith(HOME_MARK));
  return ownHome(home?.slice(HOME_MARK.length)) ? named.slice(PLUGIN_MARK.length) : null;
}

/** A process's proportional set size in bytes, or null when it cannot be read. */
async function readPss(pid: number): Promise<number | null> {
  const rollup = await readFile(`${PROC}/${pid}/smaps_rollup`, 'utf8').catch(() => null);
  return rollup === null ? null : pssOf(rollup);
}

/** The proportional set size `smaps_rollup` says, in bytes, or null when it says none. */
export function pssOf(rollup: string): number | null {
  const kilobytes = /^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1];
  return kilobytes === undefined ? null : Number(kilobytes) * 1024;
}
