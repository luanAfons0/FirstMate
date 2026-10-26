/**
 * A Place's process table, as a reader of Usage gives it, and the one tree
 * walk every reader and every row shares.
 *
 * A reader is one source of processes: this machine, through `/proc` on
 * Linux, or `Win32_Process` on Windows, or one WSL distribution through
 * `wsl.exe`. Each gives the same rows, so that what a row of Usage counts is
 * worked out once, whatever the system (ADR-0032).
 */

/** One process, as a reader saw it. */
export type ProcessFacts = {
  readonly pid: number;
  /** The PID of its parent, as the system says it now. */
  readonly parent: number;
  /**
   * When it started, in the reader's own unit. With the PID it names one
   * process, so a PID the system gave again is another process.
   */
  readonly start: number;
  /** The CPU time it has used since it started, in milliseconds. */
  readonly cpuMs: number;
  /** Its fair share of memory, in bytes. Null when the reader did not read it. */
  readonly memoryBytes: number | null;
  /**
   * The Plugin its `FIRSTMATE_PLUGIN` names, when the reader can see it and
   * the process is this Host's. Null otherwise.
   */
  readonly plugin: string | null;
};

/** One source of processes, which the Host asks each time it reads Usage. */
export type ProcessReader = {
  /**
   * Every process the source holds now. Memory is read for the roots, every
   * process under them and every process that names a Plugin, because a row
   * counts no other; it is null for the rest.
   */
  read(roots: readonly number[]): Promise<readonly ProcessFacts[]>;
};

/** The PIDs of these roots and of every process under them, as the table holds them. */
export function treeOf(table: readonly ProcessFacts[], roots: readonly number[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const one of table) {
    const siblings = children.get(one.parent);
    if (siblings === undefined) children.set(one.parent, [one.pid]);
    else siblings.push(one.pid);
  }
  const held = new Set(table.map((one) => one.pid));
  const tree = new Set<number>();
  const next = roots.filter((pid) => held.has(pid));
  for (let pid = next.pop(); pid !== undefined; pid = next.pop()) {
    // A parent the system names again is no loop, but a table read while
    // processes come and go can hold one, and a walk must still end.
    if (tree.has(pid)) continue;
    tree.add(pid);
    next.push(...(children.get(pid) ?? []));
  }
  return tree;
}
