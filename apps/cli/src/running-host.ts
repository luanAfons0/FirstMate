/**
 * The running Host, as the command line reaches it: over loopback, with the
 * port and the token from the runtime file, as the Tray reaches it.
 *
 * The runtime file says where a Host listened, not that one still listens
 * there. A Host that crashed leaves its file behind, and the port it names
 * then refuses the connection. That is read as no Host at all, the same as no
 * file, so a stale file never turns into an error the operator cannot act on.
 */
import { readRuntimeFile } from '@firstmate/core/runtime';
import type { PluginView } from '@firstmate/host/index-page';
import { TOKEN_PARAMETER } from '@firstmate/host/security';

/**
 * How long the command line waits for the Host. A reload waits for every
 * added Plugin Server to answer its handshake, so this is well over the ten
 * seconds a handshake has by default.
 */
const ANSWER_MS = 60_000;

/** What the Host said to one request. */
type HostAnswer = {
  /** The address of the Host that answered, for the operator to open. */
  readonly address: string;
  readonly status: number;
  readonly text: string;
};

/** What the running Host says about itself and every Plugin, in the Plugin Order. */
export type HostStatus = {
  readonly address: string;
  readonly plugins: readonly PluginView[];
};

/** Ask the running Host what it knows, or nothing when no Host runs. */
export async function readHostStatus(home: string): Promise<HostStatus | undefined> {
  const answer = await askHost(home, 'GET', '/plugins.json');
  if (answer === undefined) return undefined;
  if (answer.status !== 200) throw notAnswered(answer);
  const { plugins } = JSON.parse(answer.text) as { plugins: PluginView[] };
  return { address: answer.address, plugins };
}

/**
 * One request to the running Host, or nothing when no Host runs. The token
 * goes in the address, as the Tray sends it, and no Origin goes with it:
 * the command line is not a browser, and does not act like one.
 */
async function askHost(
  home: string,
  method: 'GET' | 'POST',
  path: string,
): Promise<HostAnswer | undefined> {
  const runtime = readRuntimeFile(home);
  if (runtime === undefined) return undefined;
  const address = `http://127.0.0.1:${runtime.port}/`;
  const url = new URL(path, address);
  url.searchParams.set(TOKEN_PARAMETER, runtime.token);

  let response: Response;
  try {
    response = await fetch(url, { method, signal: AbortSignal.timeout(ANSWER_MS) });
  } catch (fault) {
    if (refused(fault)) return undefined;
    throw new Error(`The Host at ${address} did not answer.`, { cause: fault });
  }
  return { address, status: response.status, text: await response.text() };
}

/** Whether nothing listens where the runtime file says a Host does. */
function refused(fault: unknown): boolean {
  const cause = fault instanceof Error ? fault.cause : undefined;
  return (cause as NodeJS.ErrnoException | undefined)?.code === 'ECONNREFUSED';
}

/** The Host's own sentence, when it answered and did not do what it was asked. */
function notAnswered(answer: HostAnswer): Error {
  const said = answer.text.trim();
  return new Error(said === '' ? `The Host answered ${answer.status}.` : said);
}
