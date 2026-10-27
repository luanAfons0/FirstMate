/**
 * What a test may ask the system's process table, and a wait for it.
 *
 * A test looks at the process table only to prove which processes run or
 * end (AGENTS.md "Testing"), never at a module of the Host. These are the
 * two questions every such test asks, written once.
 */
import { readFileSync } from 'node:fs';

/**
 * Whether a process of this PID runs now. On Linux a zombie has ended, and
 * waits only to be reaped, so it does not run.
 */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
}

/** Wait until the check holds, and fail with this sentence if it does not in time. */
export async function untilTrue(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  failure = `it did not happen in ${timeoutMs / 1000} s`,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(failure);
    await new Promise((done) => setTimeout(done, 20));
  }
}
