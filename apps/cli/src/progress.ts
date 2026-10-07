/**
 * A long wait, shown on a terminal: a spinner, or a progress bar when its
 * size is known.
 *
 * It follows the rule the questions follow (ADR-0025): the clack form only
 * where stdin and stdout are both a TTY. Anywhere else a wait shows nothing,
 * so piped output keeps exactly the lines it had.
 *
 * Clack puts the terminal in raw mode while it draws, which turns Ctrl-C into
 * a key and leaves a running `git` or installer with no signal. The wait
 * gives the terminal back its signals at once, so that Ctrl-C stops the
 * command and its child together, as it does with no spinner, and the
 * command ends 130.
 *
 * Clack is loaded when a wait starts on a terminal, and never from a pipe, so
 * a command that waits for nothing loads none of it.
 */
import { onTerminal } from './prompt.ts';

/** A wait as its caller moves it: further along, then done or failed. */
export type Wait = {
  /** Count this many more bytes as arrived. */
  advance(bytes: number): void;
  /** It ended well, and this says what it did, or nothing is said. */
  done(said: string | undefined): void;
  /** It failed. The sentence that says why is the caller's to print. */
  failed(): void;
};

/** Move the cursor up one line, and erase that line. */
const ERASE_LINE_ABOVE = '\x1b[1A\x1b[2K';

/** A wait that shows nothing, for a pipe. */
const UNSEEN: Wait = { advance: () => undefined, done: () => undefined, failed: () => undefined };

/**
 * Start a wait that says what it is doing. With a size in bytes it is a
 * progress bar with the bytes so far; with bytes counted but no size it is a
 * spinner with the bytes so far; with neither it is a spinner.
 */
export async function startWait(doing: string, size?: number): Promise<Wait> {
  if (!onTerminal()) return UNSEEN;
  const { progress, settings, spinner } = await import('@clack/prompts');
  const stopped = { cancelMessage: `${doing} stopped.`, onCancel: () => process.exit(130) };
  const bar = size !== undefined && size > 0 ? progress({ ...stopped, max: size }) : undefined;
  const shown = bar ?? spinner(stopped);
  shown.start(doing);
  // Clack has just set raw mode; give Ctrl-C back to the terminal.
  process.stdin.setRawMode(false);
  let arrived = 0;
  return {
    advance(bytes) {
      arrived += bytes;
      if (bar === undefined) shown.message(`${doing}  ${megabytes(arrived)}`);
      else bar.advance(bytes, `${doing}  ${megabytes(arrived)} of ${megabytes(size ?? 0)}`);
    },
    done(said) {
      if (said !== undefined) {
        shown.stop(said);
        return;
      }
      shown.clear();
      // The guide line clack drew above the spinner goes too, so nothing is left.
      if (settings.withGuide) process.stdout.write(ERASE_LINE_ABOVE);
    },
    failed: () => shown.error(doing),
  };
}

/**
 * Wait on some work with a spinner, and stop it however the work ends. When
 * `done` gives back nothing, the spinner goes and leaves no line.
 */
export async function whileWaiting<T>(
  doing: string,
  done: (value: T) => string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const wait = await startWait(doing);
  try {
    const value = await work();
    wait.done(done(value));
    return value;
  } catch (fault) {
    wait.failed();
    throw fault;
  }
}

/** Bytes as megabytes, to one place. */
function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
