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
 *
 * The pipe is two-way. A Plugin Server may speak on its own account, and the
 * Host answers it here. Each side numbers its own requests, so an inbound
 * message is read as a question whenever it names a method, and only then as
 * an answer (issue #40).
 */
import type { ChildProcess } from 'node:child_process';

/** How long a call waits before it gives up on a Plugin Server. */
export const CALL_TIMEOUT_MS = 30_000;

/** JSON-RPC's own number for a method the answering side does not carry. */
const METHOD_NOT_FOUND = -32601;

/** The range JSON-RPC leaves to the application. This one is the Host's. */
const HOST_ERROR = -32000;

export type JsonRpcMessage = Record<string, unknown>;

/** One answer to a Plugin Server's own question: a result, or an error. */
export type Answer =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } };

/**
 * What the Host answers a Plugin Server that asks it for something.
 *
 * It is given the method and the params and never the id, because the id
 * belongs to the Plugin Server alone: whatever answers must not be able to
 * renumber the question it was asked.
 */
export type Answering = (method: string, params: unknown) => Promise<Answer>;

/** The one sentence a Plugin Server gets for a method the Host does not carry. */
export function noSuchMethod(method: string): Answer {
  return {
    error: { code: METHOD_NOT_FOUND, message: `The Host carries no method named ${method}.` },
  };
}

/** A Host that has been given nothing to answer with carries nothing. */
const CARRIES_NOTHING: Answering = (method) => Promise.resolve(noSuchMethod(method));

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

export function speak(
  child: ChildProcess,
  name: string,
  answering: Answering = CARRIES_NOTHING,
): PluginServer {
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
      receive(rest.slice(0, newline), pending, name, asked);
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

  /**
   * A Plugin Server asking the Host for something. The answer goes back down
   * the same pipe, carrying the id the Plugin Server gave and never one of the
   * Host's own, so the two sides keep their own numbers (issue #40).
   *
   * A message with no id is a notification: there is nothing to answer, so it
   * is dropped, as it always was.
   */
  const asked = (method: string, message: JsonRpcMessage): void => {
    const id = message['id'];
    if (id === undefined || id === null) return;
    answering(method, message['params']).then(
      (answer) => send({ jsonrpc: '2.0', id, ...answer }),
      // Whatever answers is the Host's own code. A fault in it is the Host's
      // to say out loud, not a silence for the Plugin Server to wait through.
      (cause: unknown) => {
        const why = cause instanceof Error ? cause.message : String(cause);
        send({ jsonrpc: '2.0', id, error: { code: HOST_ERROR, message: why } });
      },
    );
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

function receive(
  line: string,
  pending: Map<number, Pending>,
  name: string,
  asked: (method: string, message: JsonRpcMessage) => void,
): void {
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
  // A message that names a method is the Plugin Server speaking on its own
  // account, and is never an answer to the Host. This is tested before the id
  // is looked up because each side numbers its own requests: a Plugin Server's
  // id 3 is not the Host's id 3, and reading it as one would hand a waiting
  // caller somebody else's question in place of its answer (issue #40).
  const method = message['method'];
  if (typeof method === 'string') {
    asked(method, message);
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
