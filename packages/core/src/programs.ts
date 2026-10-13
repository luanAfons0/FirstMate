/**
 * Programs on this machine: find one on PATH, and end one with every process
 * under it.
 *
 * The Mate looks for the operator's Agent on PATH, and the Places look for
 * `wsl.exe` there, so both find a program the same way. The Mate stops an
 * answer and the Host stops a Plugin Server that would not end, and both end
 * the whole tree, because a program started from a `.cmd` is cmd.exe with the
 * real program under it (ADR-0019).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Whether this process runs on Windows, where a program is found and ended its own way. */
const ON_WINDOWS = process.platform === 'win32';

/** The PATH of this environment, as Windows or anywhere else names it. */
export function pathOf(env: NodeJS.ProcessEnv): string {
  return env['PATH'] ?? env['Path'] ?? '';
}

/**
 * The first program on PATH with one of these file names, tried in order in
 * each directory, or nothing when none is there.
 */
export function findOnPath(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const directories = pathOf(env)
    .split(delimiter)
    .filter((one) => one !== '');
  for (const directory of directories) {
    for (const name of names) {
      const path = join(directory, name);
      if (isProgram(path)) return path;
    }
  }
  return undefined;
}

/** Whether a path is a file that may be run. Windows runs any file it finds. */
export function isProgram(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!ON_WINDOWS) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * End a process and every process under it: on Windows with `taskkill /t`,
 * and elsewhere through its process group, when it leads one. A process that
 * leads no group, or a `taskkill` that is missing or fails, still ends the
 * process itself with this signal.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (ON_WINDOWS) {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.once('error', () => child.kill(signal));
    taskkill.once('exit', (code) => {
      if (code !== 0) child.kill(signal);
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
