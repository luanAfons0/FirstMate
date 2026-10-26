/**
 * Usage in a `wsl` Place: the distribution's `/proc`, printed as text by one
 * `wsl.exe` call per reading and read by the same functions as Linux
 * (ADR-0032).
 *
 * Windows sees only `wsl.exe`, so a Plugin's processes are found inside the
 * distribution by the `FIRSTMATE_PLUGIN` the Supervisor puts on its command
 * line. The call prints only the `FIRSTMATE_` variables of each process, never
 * the rest of its environment, and memory for every process, because it
 * cannot know before it reads which ones a row will count: the PSS where it
 * may read it, and the resident size of every process, which a process whose
 * PSS it may not read counts instead, as on Linux.
 */
import { printedInside } from '@firstmate/core/wsl';
import type { ProcessFacts, ProcessReader } from './process-table.ts';
import { memoryOf, pluginOf, statOf, type OwnHome } from './usage-linux.ts';

/**
 * How long one call may take before its Plugins' rows say it did not answer.
 * A distribution that holds a running Plugin answers in a fraction of it.
 */
const WSL_WAIT_MS = 3_000;

/**
 * One line per file: `<pid>/<file>:<line>`. A process that ends while it is
 * read leaves a line out, which is no failure, so only `cd` may fail.
 */
const PRINT_PROC = [
  'cd /proc || exit 1',
  "grep -H '' [0-9]*/stat 2>/dev/null",
  "grep -a -z -H '^FIRSTMATE_' [0-9]*/environ 2>/dev/null | tr '\\0' '\\n'",
  "grep -H '^Pss:' [0-9]*/smaps_rollup 2>/dev/null",
  "grep -H '^VmRSS:' [0-9]*/status 2>/dev/null",
  'exit 0',
].join('; ');

/** One line of what the call printed. */
const LINE = /^(\d+)\/(stat|environ|smaps_rollup|status):(.*)$/;

/**
 * The reader of one distribution's `/proc`. Windows hands no variable to a
 * distribution, so a Plugin Server there holds no `FIRSTMATE_HOME`; one that
 * holds the Host's own is this Host's too, as when a test's fake distribution
 * is this machine.
 */
export function wslReader(distribution: string, home: string | undefined): ProcessReader {
  const ownHome: OwnHome = (named) => named === undefined || named === home;
  return {
    async read() {
      return tableOf(await printedInside(distribution, PRINT_PROC, WSL_WAIT_MS), ownHome);
    },
  };
}

/** The process table in what the call printed. */
function tableOf(printed: string, ownHome: OwnHome): ProcessFacts[] {
  const stats = new Map<number, string>();
  const environments = new Map<number, string[]>();
  const rollups = new Map<number, string>();
  const statuses = new Map<number, string>();
  for (const line of printed.split('\n')) {
    const [, pid, file, text] = LINE.exec(line) ?? [];
    if (pid === undefined || text === undefined) continue;
    const of = Number(pid);
    if (file === 'stat') stats.set(of, text);
    else if (file === 'smaps_rollup') rollups.set(of, text);
    else if (file === 'status') statuses.set(of, text);
    else environments.set(of, [...(environments.get(of) ?? []), text]);
  }
  return [...stats.values()].flatMap((text) => {
    const stat = statOf(text);
    if (stat === null) return [];
    return [
      {
        ...stat,
        plugin: pluginOf((environments.get(stat.pid) ?? []).join('\0'), ownHome),
        memoryBytes: memoryOf(rollups.get(stat.pid), statuses.get(stat.pid)),
      },
    ];
  });
}
