/**
 * The Process View's reading of Usage, in the main process: one ask of
 * `/processes.json` every 2 seconds while the view is shown and the window is
 * visible, and none at all otherwise.
 *
 * The timer is the App's, not the Host's: the Host reads Usage when asked and
 * keeps none of it (ADR-0004, ADR-0032). The next ask waits for the answer to
 * the last one, so a slow reading never piles asks up on the Host. An answer
 * that arrives after the view closed or the window hid is dropped.
 */
import type { ProcessesAnswer } from './host-lists.ts';
import { EVERY_MS } from './process-view.ts';

/** The polling of `/processes.json`, as the window drives it. */
export type Polling = {
  /**
   * Whether the view is shown in a visible window now. The first `true` reads
   * at once and then every 2 seconds; `false` stops reading.
   */
  shown(now: boolean): void;
  /** Read again at once, such as after a restart, when the view is shown. */
  again(): void;
};

/**
 * Read Usage with `read` while the view is shown, and hand each answer to
 * `told`.
 */
export function keepReading(
  read: () => Promise<ProcessesAnswer>,
  told: (usage: ProcessesAnswer) => void,
): Polling {
  /** Counted at each start and stop, so an answer from an earlier run is dropped. */
  let run = 0;
  let on = false;
  let timer: NodeJS.Timeout | undefined;
  /** Whether the last failure was said, so one that repeats is said once. */
  let said = false;

  const ask = (): void => {
    timer = undefined;
    const mine = run;
    const asked = Date.now();
    void read()
      .then((usage) => {
        if (mine !== run) return;
        told(usage);
        said = false;
      })
      .catch((fault: unknown) => {
        // A fault here must not end the polling: say it once, and read on.
        if (!said) console.error('FirstMate: the Process View could not show a reading.', fault);
        said = true;
      })
      .finally(() => {
        if (mine !== run) return;
        timer = setTimeout(ask, Math.max(EVERY_MS - (Date.now() - asked), 0));
      });
  };

  const stop = (): void => {
    run += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    shown(now) {
      if (now === on) return;
      on = now;
      stop();
      if (on) ask();
    },
    again() {
      if (!on) return;
      stop();
      ask();
    },
  };
}
