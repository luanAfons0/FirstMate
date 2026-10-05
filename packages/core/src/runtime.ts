/**
 * The runtime file: the port the Host actually listened on and the token it
 * minted at startup.
 *
 * The Tray is a Windows process and the Host is a Linux process, so the two
 * find each other through this file and through no configuration (ADR-0007).
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The runtime file, inside the Host's home directory. */
export const RUNTIME_FILE = 'runtime.json';

/** What the runtime file holds. */
export type Runtime = {
  /** The port the Host listened on, which is never zero. */
  readonly port: number;
  /** The token minted when the Host started. It lives only in memory and here. */
  readonly token: string;
};

/** The path of the runtime file in a home directory. */
export function runtimePath(home: string): string {
  return join(home, RUNTIME_FILE);
}

/**
 * Write the runtime file, replacing whatever the last run left. It holds a
 * token, so it is written for this user alone and is never half written: a
 * Tray reading it always sees one whole run or the one before it.
 */
export function writeRuntimeFile(home: string, runtime: Runtime): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = runtimePath(home);
  const pending = `${path}.pending`;
  // A mode is given to a file only when it is created, so a pending file some
  // earlier run left behind goes first rather than lend the token its mode.
  rmSync(pending, { force: true });
  writeFileSync(pending, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
  renameSync(pending, path);
}

/** Take the runtime file away, because the run it describes is over. */
export function removeRuntimeFile(home: string): void {
  rmSync(runtimePath(home), { force: true });
}
