/**
 * Download a file of a GitHub Release, and check it against the SHA-256
 * published beside it.
 *
 * The file is fetched whole and hashed before it is given back, so a file that
 * does not match is refused here, before anything writes it anywhere and
 * before anything runs it. The checksum is in the form `sha256sum` writes:
 * the hash first, in hex, then the file's name. Both `firstmate desktop` (the
 * App's installer) and the install of a Plugin Release (ADR-0033) use this
 * one module, so they trust a download by the same rule.
 *
 * Core draws no progress of its own. The command line owns the terminal
 * (ADR-0025), so it passes in the wait to show, and a caller with none shows
 * nothing.
 */
import { createHash } from 'node:crypto';
import { refuse } from './refusal.ts';

/**
 * Why a fetch failed, in the words of what failed under it. Node's `fetch`
 * throws a bare "fetch failed" and puts the reason, such as a refused
 * connection, in its cause, so the cause is what the operator is shown.
 */
export function faultReason(fault: unknown): string {
  const cause = fault instanceof Error && fault.cause instanceof Error ? fault.cause : fault;
  return cause instanceof Error ? cause.message : String(cause);
}

/** A wait as its caller moves it: further along, then done or failed. */
export type Wait = {
  /** Count this many more bytes as arrived. */
  advance(bytes: number): void;
  /** It ended well, and this says what it did, or nothing is said. */
  done(said: string | undefined): void;
  /** It failed. The sentence that says why is the caller's to print. */
  failed(): void;
};

/** Start a wait that says what it is doing, with its size in bytes when that is known. */
type StartWait = (doing: string, size?: number) => Promise<Wait>;

/** A wait that shows nothing. */
const UNSEEN: Wait = { advance: () => undefined, done: () => undefined, failed: () => undefined };

/** What to download, and how to say each step of it. */
export type CheckedDownload = {
  /** The file's URL. Its SHA-256 is at the same URL with `.sha256` after it. */
  readonly url: string;
  /** What the file is, for the sentence that refuses it: "installer". */
  readonly what: string;
  /** The sentence for a URL the Release does not hold. */
  readonly missing: (url: string) => string;
  /** Said once the checksum is known, before the file is fetched. */
  readonly announce?: string;
  /** What the download is doing, shown while the bytes arrive. */
  readonly doing: string;
  /** What to say when the bytes have arrived. */
  readonly downloaded: (bytes: Buffer) => string;
  /** How a wait is shown. Nothing is shown when this is not given. */
  readonly startWait?: StartWait;
};

/**
 * The file at the URL, whole, when its SHA-256 is the one published beside it.
 * Any other outcome is a thrown sentence: a refusal when the Release does not
 * hold the file or the hash differs, an error when the network fails.
 */
export async function fetchChecked(options: CheckedDownload): Promise<Buffer> {
  const { url, what, missing, startWait = async () => UNSEEN } = options;
  const expected = await publishedChecksum(`${url}.sha256`, missing);
  if (options.announce !== undefined) console.log(options.announce);
  const bytes = await download(url, missing, options.doing, options.downloaded, startWait);
  const check = await startWait('checking the SHA-256');
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    check.failed();
    throw refuse(
      'invalid',
      `the ${what} from ${url} does not match its published SHA-256, so it was not run.`,
    );
  }
  check.done('the SHA-256 matches');
  return bytes;
}

/** The SHA-256 published beside a file, in lower-case hex. */
async function publishedChecksum(url: string, missing: (url: string) => string): Promise<string> {
  const text = (await download(url, missing)).toString('utf8');
  const hash = /^([0-9a-f]{64})(?:\s|$)/i.exec(text.trim())?.[1];
  if (hash === undefined) throw refuse('invalid', `${url} does not hold a SHA-256 checksum.`);
  return hash.toLowerCase();
}

/**
 * One file of the Release, whole. A Release that does not hold it is a
 * refusal. With something it is `doing`, the download is shown as it arrives:
 * a progress bar when the Release says its length, a spinner when it does not.
 */
async function download(
  url: string,
  missing: (url: string) => string,
  doing?: string,
  downloaded?: (bytes: Buffer) => string,
  startWait?: StartWait,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (fault) {
    throw new Error(`${url} could not be downloaded: ${faultReason(fault)}.`, { cause: fault });
  }
  if (response.status === 404) throw refuse('missing', missing(url));
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  if (doing === undefined || startWait === undefined || response.body === null) {
    return Buffer.from(await response.arrayBuffer());
  }

  const length = Number(response.headers.get('content-length'));
  const wait = await startWait(doing, Number.isSafeInteger(length) ? length : undefined);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of response.body) {
      chunks.push(chunk);
      wait.advance(chunk.byteLength);
    }
  } catch (fault) {
    wait.failed();
    throw fault;
  }
  const bytes = Buffer.concat(chunks);
  wait.done(downloaded?.(bytes));
  return bytes;
}
