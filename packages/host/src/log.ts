/**
 * The log: everything the Host says, and every Plugin Server's stderr with it,
 * kept in one file in the home directory.
 *
 * Under systemd this was the journal. The App has no journal and no console,
 * so the Host keeps its own output where `firstmate logs` reads it, whether it
 * runs in the App or in a terminal. It is the Host's one log, not a record per
 * Plugin, so ADR-0005 holds: the Host keeps no history of any Plugin's own
 * (ADR-0022).
 *
 * The file never grows past its cap. When the next line would take it past,
 * the file becomes `firstmate.log.old`, replacing the one before, and a new
 * file begins. The token never reaches either: a credential has no place in a
 * file a person may paste into a bug report.
 *
 * A write is held in memory and appended once per tick, asynchronously, so a
 * Plugin Server that says a great deal on stderr does not hold up the Host or
 * the App with a write to disk per line. What is still held when the Host
 * stops, when the App quits, when the process exits, and on an uncaught
 * exception is written synchronously, so no line said before the end is lost.
 */
import { appendFile, appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { logPath, oldLogPath } from '@firstmate/core/runtime';

/** The most bytes one log file holds. Two of them are a few days of a busy Host. */
const LOG_CAP = 2 * 1024 * 1024;

/** The log this process keeps, and the way to write what it still holds. */
export type KeptLog = {
  /** Wait until everything said so far is in the file. */
  drained(): Promise<void>;
  /** Write what is still held, synchronously. For the moments the process may end. */
  flush(): void;
};

/** Every log this process keeps, so that `flushLog` reaches each one. */
const kept: KeptLog[] = [];

/**
 * Write what every log of this process still holds, synchronously. The App
 * calls it last, just before it exits.
 */
export function flushLog(): void {
  for (const log of kept) log.flush();
}

/**
 * From now on, write what this process says to its stdout and stderr into the
 * log as well, with the secret taken out. The streams still say it, so a
 * terminal still shows it.
 */
export function keepLog(home: string, secret: string): KeptLog {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = logPath(home);
  // The bytes of the file as it will be once every write handed to it lands.
  let size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  // Said, and not yet handed to the file.
  let held: Buffer[] = [];
  // Handed to the file and not yet known to have landed, with the size the
  // file had before it.
  let landing: { readonly bytes: Buffer; readonly from: number } | undefined;
  let soon = false;
  const waiting: (() => void)[] = [];

  /** What is held, as one write, ready for a file that keeps under its cap. */
  const take = (): Buffer | undefined => {
    if (held.length === 0) return undefined;
    let bytes = Buffer.concat(held);
    held = [];
    // A write larger than the cap keeps its end, which is the part a person
    // reading the log after a failure needs.
    if (bytes.length > LOG_CAP) bytes = bytes.subarray(bytes.length - LOG_CAP);
    if (size + bytes.length > LOG_CAP) {
      renameSync(path, oldLogPath(home));
      size = 0;
    }
    return bytes;
  };

  const settled = (): void => {
    if (held.length > 0 || landing !== undefined) return;
    for (const done of waiting.splice(0)) done();
  };

  const drain = (): void => {
    soon = false;
    if (landing !== undefined) return;
    const bytes = guarded(take);
    if (bytes === undefined) {
      settled();
      return;
    }
    landing = { bytes, from: size };
    size += bytes.length;
    appendFile(path, bytes, { mode: 0o600 }, () => {
      // A log that cannot be written must not take the Host down with it.
      landing = undefined;
      if (held.length > 0) schedule();
      else settled();
    });
  };

  const schedule = (): void => {
    if (soon) return;
    soon = true;
    setImmediate(drain);
  };

  const flush = (): void => {
    guarded(() => {
      if (landing !== undefined) {
        // The write in flight may have landed, wholly or in part. Only what
        // the file does not hold yet is written again.
        const now = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
        const missing = landing.bytes.subarray(Math.max(0, now - landing.from));
        if (missing.length > 0) appendFileSync(path, missing, { mode: 0o600 });
        landing = undefined;
      }
      const bytes = take();
      if (bytes !== undefined) {
        appendFileSync(path, bytes, { mode: 0o600 });
        size += bytes.length;
      }
    });
    settled();
  };

  const keep = (text: string): void => {
    held.push(Buffer.from(text.replaceAll(secret, '<token>')));
    schedule();
  };

  for (const stream of [process.stdout, process.stderr]) {
    const say = stream.write.bind(stream) as (...given: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      guarded(() =>
        keep(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString()),
      );
      return say(chunk, ...rest);
    }) as typeof stream.write;
  }

  // The process can end without the Host being stopped: an uncaught exception,
  // or a call to exit. Both are moments where only a synchronous write lands.
  process.on('uncaughtExceptionMonitor', flush);
  process.on('exit', flush);

  const log: KeptLog = {
    drained: () =>
      new Promise((done) => {
        waiting.push(done);
        settled();
      }),
    flush,
  };
  kept.push(log);
  return log;
}

/** What this returns, or nothing when it throws: a log must not take the Host down. */
function guarded<T>(job: () => T): T | undefined {
  try {
    return job();
  } catch {
    return undefined;
  }
}
