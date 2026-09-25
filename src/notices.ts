/**
 * The Notices: short messages the Tray shows in a Windows pop-up, held by the
 * Host for a short time until the Tray reads them (ADR-0014).
 *
 * A Plugin Server sends one on the pipe the Host owns, so the sender's Plugin
 * Name comes from the connection and never from what the Plugin says. The Host
 * sends its own when a Plugin goes Stopped. Both land on one queue in memory,
 * and nothing about a Notice is ever written to disk (ADR-0005).
 *
 * The Host promises nothing about delivery. A Notice no Tray reads in time is
 * gone, and the answer a Plugin Server gets means "accepted" and nothing more.
 */
import { HOST_ERROR, type Answer } from './mcp.ts';
import { isPluginPath } from './shortcut.ts';

/** The method a Plugin Server sends a Notice with. */
export const SEND_NOTICE = 'firstmate/notice';

/** How many Notices the Host holds at once. The oldest go first. */
export const QUEUE_LIMIT = 20;

/** The longest title a Plugin may give, before the Host puts its name in front. */
export const TITLE_LIMIT = 64;

/** The longest body a Plugin may give. */
export const BODY_LIMIT = 200;

/**
 * How long a Plugin waits between two Notices. A Plugin that sends more often
 * would bury the operator's screen in pop-ups, so the Host refuses, and says so.
 */
export const NOTICE_GAP_MS = 5_000;

/** The name a Host Notice speaks under. No Plugin Name can be it: those are lowercase. */
const HOST_NAME = 'FirstMate';

/** One Notice, as the Tray reads it. */
export type Notice = {
  /** Its place on the queue. It only goes up while the Host runs. */
  readonly sequence: number;
  /** `<sender>: <title>`, so that the sender is always named first. */
  readonly title: string;
  readonly body: string;
  /** The address a click opens: under the sender's `/p/<name>/`, or `/`. */
  readonly address: string;
};

/** What `/notices.json` answers: the Notices after a cursor, and where to move it. */
export type NoticesAfter = {
  /** The last sequence number the Host gave out in this run, or zero. */
  readonly latest: number;
  readonly notices: readonly Notice[];
};

export type Notices = {
  /** Take a Notice from a Plugin Server, or refuse it with a sentence. */
  send(from: string, params: unknown): Answer;
  /** Put the Host's own Notice on the queue. It opens the Index Page. */
  fromHost(title: string, body: string): void;
  /** The Notices after this sequence number that have not expired, in order. */
  after(sequence: number): NoticesAfter;
};

/**
 * Open an empty queue. `noticeMs` is how long a Notice lives, and it comes from
 * `FIRSTMATE_NOTICE_MS` so that a test can prove the expiry in milliseconds.
 */
export function openNotices(noticeMs: number, now: () => number = Date.now): Notices {
  const held: { readonly notice: Notice; readonly at: number }[] = [];
  // When each Plugin last had a Notice accepted, for the gap between two.
  const lastSent = new Map<string, number>();
  let latest = 0;

  const hold = (title: string, body: string, address: string): void => {
    latest += 1;
    held.push({ notice: { sequence: latest, title, body, address }, at: now() });
    if (held.length > QUEUE_LIMIT) held.splice(0, held.length - QUEUE_LIMIT);
  };

  return {
    send(from, params) {
      const asked = (params ?? {}) as Record<string, unknown>;
      const refusal = check(from, asked);
      if (refusal !== null) return refuse(refusal);

      // The gap is checked after the text, so that a Plugin that sends a bad
      // Notice hears what is wrong with it and not only that it was too soon.
      const at = now();
      const last = lastSent.get(from);
      if (last !== undefined && at - last < NOTICE_GAP_MS) {
        return refuse(
          `A Plugin may send one Notice every ${NOTICE_GAP_MS / 1000} s. ` +
            `The last one from ${from} was ${at - last} ms ago.`,
        );
      }
      lastSent.set(from, at);

      const path = asked['path'] ?? '';
      hold(
        `${from}: ${asked['title'] as string}`,
        asked['body'] as string,
        `/p/${encodeURIComponent(from)}/${path as string}`,
      );
      return { result: {} };
    },
    fromHost(title, body) {
      hold(`${HOST_NAME}: ${title}`, body, '/');
    },
    after(sequence) {
      const alive = now() - noticeMs;
      // Expired Notices go when the queue is read. Nothing else needs them gone
      // sooner, and the Host keeps no timer for them.
      while (held.length > 0 && (held[0]?.at ?? 0) <= alive) held.shift();
      return {
        latest,
        notices: held.filter((one) => one.notice.sequence > sequence).map((one) => one.notice),
      };
    },
  };
}

/**
 * What is wrong with a Notice, as a sentence, or null when nothing is. The Host
 * never cuts a text short to make it fit: it refuses, and the Plugin fixes it.
 */
function check(from: string, asked: Record<string, unknown>): string | null {
  const title = asked['title'];
  if (typeof title !== 'string' || title === '') {
    return `A ${SEND_NOTICE} needs a "title": a string of 1 to ${TITLE_LIMIT} characters.`;
  }
  if ([...title].length > TITLE_LIMIT) {
    return (
      `The "title" of a Notice may be ${TITLE_LIMIT} characters long, ` +
      `and this one is ${[...title].length}.`
    );
  }
  const body = asked['body'];
  if (typeof body !== 'string') {
    return `A ${SEND_NOTICE} needs a "body": a string of at most ${BODY_LIMIT} characters.`;
  }
  if ([...body].length > BODY_LIMIT) {
    return (
      `The "body" of a Notice may be ${BODY_LIMIT} characters long, ` +
      `and this one is ${[...body].length}.`
    );
  }
  const path = asked['path'];
  if (path !== undefined && typeof path !== 'string') {
    return `The "path" of a Notice must be a string, not ${JSON.stringify(path)}.`;
  }
  if (path !== undefined && !isPluginPath(path, from)) {
    return `The "path" ${JSON.stringify(path)} leaves the address of ${from}, /p/${from}/.`;
  }
  return null;
}

/** Every refusal is a sentence the Plugin author can act on. */
function refuse(why: string): Answer {
  return { error: { code: HOST_ERROR, message: why } };
}
