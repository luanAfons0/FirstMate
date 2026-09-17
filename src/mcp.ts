/**
 * The Host as an MCP client: one connection to one Plugin Server, over that
 * process's stdin and stdout.
 *
 * MCP's stdio transport is one JSON-RPC message per line. The Host needs a
 * JSON-RPC client and nothing more, so it has one rather than a dependency.
 *
 * A Plugin Page and the Host share this one connection, so every request is
 * renumbered on the way out and given its own number back on the way in. Two
 * callers can then use the same Plugin Server without ever seeing each other.
 */
import type { ChildProcess } from 'node:child_process';

/** How long a call waits before it gives up on a Plugin Server. */
export const CALL_TIMEOUT_MS = 30_000;

export type JsonRpcMessage = Record<string, unknown>;

export type PluginServer = {
  /** True while the process is alive. */
  alive(): boolean;
  /** Send one request and wait for its answer. */
  call(message: JsonRpcMessage, timeoutMs?: number): Promise<JsonRpcMessage>;
  /** Send one message that has no answer. */
  notify(message: JsonRpcMessage): void;
  /** Ask the process to end. */
  stop(): void;
};

type Pending = {
  readonly id: unknown;
  readonly settle: (message: JsonRpcMessage) => void;
  readonly fail: (cause: Error) => void;
  readonly timer: NodeJS.Timeout;
};

export function speak(child: ChildProcess, name: string): PluginServer {
  const pending = new Map<number, Pending>();
  let counter = 0;
  let alive = true;

  const stdin = child.stdin;
  const stdout = child.stdout;
  if (stdin === null || stdout === null) {
    throw new Error(`The Plugin Server of ${name} has no stdin and stdout to speak over.`);
  }

  let rest = '';
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    rest += chunk;
    let newline = rest.indexOf('\n');
    while (newline >= 0) {
      receive(rest.slice(0, newline), pending, name);
      rest = rest.slice(newline + 1);
      newline = rest.indexOf('\n');
    }
  });

  const ended = (why: string): void => {
    alive = false;
    const ending = new Error(`The Plugin Server of ${name} stopped (${why}).`);
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.fail(ending);
    }
    pending.clear();
  };
  child.once('exit', (code, signal) => ended(signal ?? `exit ${code ?? 0}`));
  // A process that could not be spawned at all emits this and may never emit
  // an exit, so a caller would otherwise wait for an answer that cannot come.
  child.once('error', (cause: Error) => ended(cause.message));
  // Writing into a Plugin Server that has just died raises EPIPE on the pipe
  // itself. Unheard, that ends the Host, and one dead Plugin must leave every
  // other one serving.
  stdin.on('error', (cause: Error) => ended(cause.message));
  stdout.on('error', (cause: Error) => ended(cause.message));

  /** One line to the Plugin Server, or false when the pipe is already gone. */
  const send = (message: JsonRpcMessage): boolean => {
    try {
      stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  };

  return {
    alive: () => alive,
    notify(message) {
      if (!alive) return;
      send(message);
    },
    call(message, timeoutMs = CALL_TIMEOUT_MS) {
      if (!alive) {
        return Promise.reject(new Error(`The Plugin Server of ${name} is not running.`));
      }
      const ours = ++counter;
      return new Promise<JsonRpcMessage>((settle, fail) => {
        const timer = setTimeout(() => {
          pending.delete(ours);
          fail(new Error(`The Plugin Server of ${name} did not answer in ${timeoutMs} ms.`));
        }, timeoutMs);
        pending.set(ours, { id: message['id'] ?? null, settle, fail, timer });
        // A Plugin Server can die between the check above and this line, so
        // the failure is caught here rather than left to a caller that would
        // otherwise wait for the timeout.
        if (!send({ ...message, id: ours })) {
          pending.delete(ours);
          clearTimeout(timer);
          fail(new Error(`The Plugin Server of ${name} is not running.`));
        }
      });
    },
    stop() {
      if (!alive) return;
      // Closing stdin is how an MCP server over stdio is asked to end.
      stdin.end();
      child.kill('SIGTERM');
    },
  };
}

function receive(line: string, pending: Map<number, Pending>, name: string): void {
  if (line.trim() === '') return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch {
    // A Plugin Server that writes something other than JSON on stdout has
    // broken the transport. Say so where the journal keeps it.
    console.error(`FirstMate: the Plugin Server of ${name} wrote a line that is not JSON.`);
    return;
  }
  const ours = message['id'];
  if (typeof ours !== 'number') return;
  const waiting = pending.get(ours);
  if (waiting === undefined) return;
  pending.delete(ours);
  clearTimeout(waiting.timer);
  // The caller gets its own number back, never the Host's.
  waiting.settle({ ...message, id: waiting.id });
}
