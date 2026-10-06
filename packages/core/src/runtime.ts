/**
 * The runtime file: the port the Host actually listened on and the token it
 * minted at startup.
 *
 * The App holds the Host in its own process, but the command line and every
 * test do not, so they find the Host through this file and through no
 * configuration.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The runtime file, inside the Host's home directory. */
const RUNTIME_FILE = 'runtime.json';

/** The query parameter the token arrives on, once, in an address. */
export const TOKEN_PARAMETER = 'token';

/** The log a running Host keeps, inside its home directory (ADR-0022). */
const LOG_FILE = 'firstmate.log';

/** The path of the log in a home directory. */
export function logPath(home: string): string {
  return join(home, LOG_FILE);
}

/** The path of the log before the last one, which the cap keeps. */
export function oldLogPath(home: string): string {
  return `${logPath(home)}.old`;
}

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
 * reader always sees one whole run or the one before it.
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

/**
 * The runtime file the last run wrote, or nothing when no run wrote one. It
 * says where a Host listened, not that one still listens there: a Host that
 * crashed leaves its file behind.
 */
export function readRuntimeFile(home: string): Runtime | undefined {
  const path = runtimePath(home);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the runtime file at ${path}.`, { cause });
  }
  const runtime = parseRuntime(text);
  if (runtime === undefined) {
    throw new Error(`The runtime file at ${path} needs a "port" and a "token".`);
  }
  return runtime;
}

function parseRuntime(text: string): Runtime | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { port, token } = value as Record<string, unknown>;
  if (!Number.isInteger(port) || typeof port !== 'number' || port <= 0) return undefined;
  if (typeof token !== 'string' || token === '') return undefined;
  return { port, token };
}
