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
 * A write is held in memory and written once per tick, asynchronously, so a
 * Plugin Server that says a great deal on stderr does not hold up the Host or
 * the App with a write to disk per line. What is still held when the Host
 * stops, when the App quits, when the process exits, and on an uncaught
 * exception is written synchronously, so no line said before the end is lost.
 *
 * Every write names the place in the file it goes to, and only one
 * asynchronous write runs at a time. A synchronous write at the end may come
 * while that one is still on its way, and the two never meet: the end writes
 * what is held after the bytes the other carries, and writes those bytes
 * again at their own place, so they land once whichever write finishes
 * first, or if the other never does.
 */
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  write,
  writeSync,
} from 'node:fs';
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
  /**
   * The open file, and its size once every write handed to it lands. It is
   * opened without append, so each write goes to the place it names.
   */
  let file = openLog(path);
  // Said, and not yet handed to the file.
  let held: Buffer[] = [];
  // The one asynchronous write on its way: its bytes, the file it goes to,
  // and the place in that file.
  let landing: { readonly bytes: Buffer; readonly fd: number; readonly at: number } | undefined;
  let soon = false;
  const waiting: (() => void)[] = [];

  /**
   * Begin a new file in place of a full one. A file an asynchronous write is
   * still on its way to is closed once that write lands, never before, so its
   * descriptor is never reused under it.
   */
  const rotate = (): void => {
    renameSync(path, oldLogPath(home));
    const full = file.fd;
    if (landing?.fd !== full) closeSync(full);
    file = openLog(path);
  };

  /** What is held, as one write, ready for a file that keeps under its cap. */
  const take = (): Buffer | undefined => {
    if (held.length === 0) return undefined;
    let bytes = Buffer.concat(held);
    held = [];
    // A write larger than the cap keeps its end, which is the part a person
    // reading the log after a failure needs.
    if (bytes.length > LOG_CAP) bytes = bytes.subarray(bytes.length - LOG_CAP);
    if (file.size + bytes.length > LOG_CAP) rotate();
    return bytes;
  };

  const settled = (): void => {
    if (held.length > 0 || landing !== undefined) return;
    for (const done of waiting.splice(0)) done();
  };

  const drain = (): void => {
    soon = false;
    // One asynchronous write at a time: the next waits for this one.
    if (landing !== undefined) return;
    const bytes = guarded(take);
    if (bytes === undefined) {
      settled();
      return;
    }
    const going = { bytes, fd: file.fd, at: file.size };
    landing = going;
    file.size += bytes.length;
    write(going.fd, bytes, 0, bytes.length, going.at, () => {
      // A log that cannot be written must not take the Host down with it.
      landing = undefined;
      // The file was rotated away while this write was on its way to it.
      if (going.fd !== file.fd) guarded(() => closeSync(going.fd));
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
      // The asynchronous write on its way may land before this, after it, or
      // not at all if the process ends first. Its bytes are written again at
      // their own place, so they are in the file once in every case. It is
      // still the one write on its way: only its own end clears it.
      if (landing !== undefined) {
        writeSync(landing.fd, landing.bytes, 0, landing.bytes.length, landing.at);
      }
      // What no write has taken goes after it.
      const bytes = take();
      if (bytes !== undefined) {
        writeSync(file.fd, bytes, 0, bytes.length, file.size);
        file.size += bytes.length;
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

/** Open the log for writing at named places, and say how big it is. */
function openLog(path: string): { readonly fd: number; size: number } {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT, 0o600);
  return { fd, size: fstatSync(fd).size };
}

/** What this returns, or nothing when it throws: a log must not take the Host down. */
function guarded<T>(job: () => T): T | undefined {
  try {
    return job();
  } catch {
    return undefined;
  }
}
