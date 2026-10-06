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
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { logPath, oldLogPath } from '@firstmate/core/runtime';

/** The most bytes one log file holds. Two of them are a few days of a busy Host. */
const LOG_CAP = 2 * 1024 * 1024;

/**
 * From now on, write what this process says to its stdout and stderr into the
 * log as well, with the secret taken out. The streams still say it, so a
 * terminal still shows it.
 */
export function keepLog(home: string, secret: string): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = logPath(home);
  let size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;

  const keep = (text: string): void => {
    let bytes = Buffer.from(text.replaceAll(secret, '<token>'));
    // One write larger than the cap keeps its end, which is the part a person
    // reading the log after a failure needs.
    if (bytes.length > LOG_CAP) bytes = bytes.subarray(bytes.length - LOG_CAP);
    if (size + bytes.length > LOG_CAP) {
      renameSync(path, oldLogPath(home));
      size = 0;
    }
    appendFileSync(path, bytes, { mode: 0o600 });
    size += bytes.length;
  };

  for (const stream of [process.stdout, process.stderr]) {
    const say = stream.write.bind(stream) as (...given: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      try {
        keep(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
      } catch {
        // A log that cannot be written must not take the Host down with it.
      }
      return say(chunk, ...rest);
    }) as typeof stream.write;
  }
}
