/**
 * A tool call: one ordinary HTTP request from a Plugin Page to its own Plugin.
 *
 * The request body is an MCP JSON-RPC request. The Host forwards it to that
 * Plugin's Plugin Server and returns the answer. The Host is the MCP client;
 * the browser never speaks MCP itself (ADR-0003).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JsonRpcMessage, PluginServer } from './mcp.ts';

/** The largest tool call the Host will read. A tool call is not an upload. */
export const BODY_LIMIT_BYTES = 1_048_576;

/** JSON-RPC's own numbers, so that a Plugin Page can tell the faults apart. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
/** The range JSON-RPC leaves to the application. This one is the Host's. */
const HOST_ERROR = -32000;

export async function callTools(
  request: IncomingMessage,
  response: ServerResponse,
  name: string,
  server: PluginServer | null,
  state: 'running' | 'stopped' | 'no-plugin-server',
): Promise<void> {
  if (state === 'no-plugin-server') {
    // Nothing is wrong here: this Plugin ships a page and no tools.
    sendFault(response, 501, null, HOST_ERROR, `The Plugin named ${name} ships no Plugin Server.`);
    return;
  }
  if (server === null) {
    sendFault(response, 503, null, HOST_ERROR, `The Plugin named ${name} is Stopped.`);
    return;
  }

  let body: string;
  try {
    body = await read(request);
  } catch (cause) {
    sendFault(response, 413, null, INVALID_REQUEST, message(cause));
    return;
  }

  let call: JsonRpcMessage;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('A tool call is one JSON-RPC request object.');
    }
    call = parsed as JsonRpcMessage;
  } catch (cause) {
    sendFault(response, 400, null, PARSE_ERROR, message(cause));
    return;
  }

  const id = call['id'];
  if (id === undefined || id === null) {
    // A JSON-RPC notification has no answer to wait for.
    server.notify(call);
    response.writeHead(204).end();
    return;
  }

  try {
    sendJson(response, 200, await server.call(call));
  } catch (cause) {
    sendFault(response, 504, id, HOST_ERROR, message(cause));
  }
}

function read(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > BODY_LIMIT_BYTES) {
        fail(new Error(`A tool call may not be larger than ${BODY_LIMIT_BYTES} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => done(Buffer.concat(chunks).toString('utf8')));
    request.once('error', fail);
  });
}

function sendFault(
  response: ServerResponse,
  status: number,
  id: unknown,
  code: number,
  text: string,
): void {
  // The answer is a JSON-RPC error, because the caller sent a JSON-RPC
  // request and should not have to read two shapes. The status code says the
  // same thing to anything that reads only that.
  sendJson(response, status, { jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
}

function sendJson(response: ServerResponse, status: number, value: JsonRpcMessage): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  response.end(body);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
