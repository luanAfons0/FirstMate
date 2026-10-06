/**
 * The running Host, as the command line reaches it: over loopback, with the
 * port and the token from the runtime file, as the Tray reaches it.
 *
 * The runtime file says where a Host listened, not that one still listens
 * there. A Host that crashed leaves its file behind, and the port it names
 * then refuses the connection. That is read as no Host at all, the same as no
 * file, so a stale file never turns into an error the operator cannot act on.
 */
import { refuse } from '@firstmate/core/refusal';
import type { PluginView, Restarted } from '@firstmate/core/plugin-state';
import { readRuntimeFile, TOKEN_PARAMETER } from '@firstmate/core/runtime';

/**
 * How long the command line waits for the Host. A reload waits for every
 * added Plugin Server to answer its handshake, so this is well over the ten
 * seconds a handshake has by default.
 */
const ANSWER_MS = 60_000;

/** How a Host begins the sentence that refuses a request that is not its own. */
const REFUSED = 'FirstMate refused this request: no token';

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
 * Ask the running Host to read the Registry and the settings again, after a
 * command changed them. With no Host running there is nothing to ask: the
 * files are written, and the next Host reads them when it starts.
 */
export async function reloadHost(home: string): Promise<void> {
  const answer = await askHost(home, 'POST', '/reload');
  if (answer === undefined || answer.status === 200) return;
  throw new Error(`The Host did not pick the change up. ${notAnswered(answer).message}`);
}

/**
 * Ask the running Host to start one Plugin's Plugin Server again, and say
 * what became of it, or nothing when no Host runs. A Plugin the Host does not
 * hold is refused as one that is not there.
 */
export async function restartPlugin(home: string, name: string): Promise<Restarted | undefined> {
  const answer = await askHost(home, 'POST', `/restart/${encodeURIComponent(name)}`);
  if (answer === undefined) return undefined;
  if (answer.status === 404) throw refuse('missing', notAnswered(answer).message);
  if (answer.status !== 200) throw notAnswered(answer);
  return JSON.parse(answer.text) as Restarted;
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
  const text = await response.text();
  // The token is this home's, and the Host this home's runtime file names
  // admits it. A refusal of it means another Host holds that port now, one
  // started from another home after this one's Host crashed.
  if (response.status === 403 && text.startsWith(REFUSED)) return undefined;
  return { address, status: response.status, text };
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
