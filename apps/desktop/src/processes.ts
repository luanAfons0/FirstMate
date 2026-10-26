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
import type { Usage } from './host-lists.ts';
import { EVERY_MS } from './process-view.ts';

/** The reading, as the window drives it. */
export type Reading = {
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
export function keepReading(read: () => Promise<Usage>, told: (usage: Usage) => void): Reading {
  /** Counted at each start and stop, so an answer from an earlier run is dropped. */
  let run = 0;
  let on = false;
  let timer: NodeJS.Timeout | undefined;

  const ask = (): void => {
    timer = undefined;
    const mine = run;
    const asked = Date.now();
    void read().then((usage) => {
      if (mine !== run) return;
      told(usage);
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
