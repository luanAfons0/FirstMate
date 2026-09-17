/**
 * The Host's HTTP surface: the Index Page, the same list as JSON, every Plugin
 * Page, and nothing else yet.
 *
 * It binds the loopback address alone, so nothing else on the network reaches
 * it, and it is the one seam this project is tested through.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { BIND_ADDRESS } from './config.ts';
import { indexPage, type PluginView } from './index-page.ts';
import type { PluginRow } from './registry.ts';
import { checkRequest, startedByOwnPage } from './security.ts';
import { serveStatic, webRoot } from './static-files.ts';
import type { PluginState } from './supervisor.ts';
import type { PluginServer } from './mcp.ts';
import { callTools } from './tool-call.ts';

/** Every Plugin address starts here: /p/<name>/. */
const PLUGIN_PATH = /^\/p\/([^/]+)(\/.*)?$/;

export type HostOptions = {
  /** The port to listen on. Zero asks the system for a free one. */
  readonly port: number;
  /** The Registry, read once when the Host started. */
  readonly plugins: readonly PluginRow[];
  /** Where the Registry lives, so that an empty Index Page can say so. */
  readonly registryPath: string;
  /** The token minted at startup. Every request carries it or is refused. */
  readonly token: string;
  /** What the Supervisor knows about a Plugin Server right now. */
  readonly stateOf: (name: string) => PluginState;
  /** The Plugin Server of a Plugin, while it is running. */
  readonly serverOf: (name: string) => PluginServer | null;
};

/** Where a Plugin Page calls its own Plugin's tools. */
const RPC_PATH = '/rpc';

/**
 * What the Index Page lists, as JSON. The Tray is a Windows process and cannot
 * read a page meant for a person, so the Host says the same thing twice: once
 * in HTML and once here (ADR-0007).
 */
const PLUGINS_PATH = '/plugins.json';

export type Host = {
  /** The port the Host actually listened on. */
  readonly port: number;
  close(): Promise<void>;
};

export async function startHost(options: HostOptions): Promise<Host> {
  const plugins = new Map(options.plugins.map((plugin) => [plugin.name, plugin]));
  // The security check names this Host by the port it answers on, which is
  // known only once it is listening.
  let listening = 0;
  const server = createServer((request, response) => {
    handle(request, response, plugins, options, listening).catch((fault: unknown) => {
      fail(response, fault);
    });
  });
  const port = await listen(server, options.port);
  listening = port;
  return {
    port,
    close: () =>
      new Promise((done, fail) => {
        server.closeAllConnections();
        server.close((cause) => (cause ? fail(cause) : done()));
      }),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  plugins: Map<string, PluginRow>,
  options: HostOptions,
  port: number,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://firstmate.invalid');

  const admission = checkRequest(request, url, { port, token: options.token });
  if (admission.kind === 'refuse') {
    sendText(response, 403, `FirstMate refused this request: ${admission.reason}.`);
    return;
  }
  if (admission.kind === 'admit') {
    response
      .writeHead(303, { 'set-cookie': admission.cookie, location: admission.location })
      .end();
    return;
  }

  const method = request.method ?? 'GET';
  const path = url.pathname;

  if (path === '/') {
    if (!readOnly(response, method)) return;
    sendHtml(response, indexPage(pluginViews(plugins, options), options.registryPath),
      method === 'HEAD');
    return;
  }
  if (path === PLUGINS_PATH) {
    if (!readOnly(response, method)) return;
    sendJson(response, { plugins: pluginViews(plugins, options) }, method === 'HEAD');
    return;
  }
  const address = PLUGIN_PATH.exec(path);
  if (address === null) {
    sendText(response, 404, `Nothing is served at ${path}.`);
    return;
  }

  const name = decodeName(address[1] ?? '');
  const plugin = name === null ? undefined : plugins.get(name);
  if (plugin === undefined) {
    sendText(response, 404, `No Plugin is named ${address[1]}.`);
    return;
  }
  const rest = address[2];

  if (rest === RPC_PATH) {
    if (method !== 'POST') {
      response.setHeader('allow', 'POST');
      sendText(response, 405, `A tool call is a POST, not a ${method}.`);
      return;
    }
    if (!startedByOwnPage(request, plugin.name)) {
      sendText(response, 403, `Only the Plugin Page of ${plugin.name} may call its tools.`);
      return;
    }
    await callTools(
      request,
      response,
      plugin.name,
      options.serverOf(plugin.name),
      options.stateOf(plugin.name),
    );
    return;
  }

  if (!readOnly(response, method)) return;
  await sendPluginPage(response, plugin, rest, method === 'HEAD');
}

function readOnly(response: ServerResponse, method: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  response.setHeader('allow', 'GET, HEAD');
  sendText(response, 405, `${method} is not allowed here.`);
  return false;
}

/** Every Plugin the Host knows, as the Index Page and the Tray both see it. */
function pluginViews(plugins: Map<string, PluginRow>, options: HostOptions): PluginView[] {
  return [...plugins.values()].map((plugin) => ({
    name: plugin.name,
    hasPage: existsSync(webRoot(plugin.directory)),
    state: options.stateOf(plugin.name),
  }));
}

async function sendPluginPage(
  response: ServerResponse,
  plugin: PluginRow,
  rest: string | undefined,
  headOnly: boolean,
): Promise<void> {
  if (rest === undefined) {
    // Without the trailing slash every relative path inside the Plugin Page
    // would resolve one directory too high.
    response.writeHead(308, { location: `/p/${encodeURIComponent(plugin.name)}/` }).end();
    return;
  }
  const root = webRoot(plugin.directory);
  if (!existsSync(root)) {
    sendText(response, 404, `The Plugin named ${plugin.name} ships no Plugin Page.`);
    return;
  }
  const result = await serveStatic(
    response,
    root,
    rest,
    (path) => `/p/${encodeURIComponent(plugin.name)}${path}`,
    headOnly,
  );
  if (result === 'outside') {
    sendText(response, 403, `That path leaves the Plugin Page of ${plugin.name}.`);
  } else if (result === 'missing') {
    sendText(response, 404, `The Plugin named ${plugin.name} serves nothing at ${rest}.`);
  }
}

function decodeName(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function sendHtml(response: ServerResponse, html: string, headOnly: boolean): void {
  const body = Buffer.from(html, 'utf8');
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  response.end(headOnly ? undefined : body);
}

function sendJson(response: ServerResponse, value: unknown, headOnly: boolean): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  response.end(headOnly ? undefined : body);
}

export function sendText(response: ServerResponse, status: number, text: string): void {
  const body = Buffer.from(`${text}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  response.end(body);
}

function fail(response: ServerResponse, cause: unknown): void {
  // The operator reads this in the journal; the caller gets the same sentence.
  console.error('FirstMate: a request failed.', cause);
  if (!response.headersSent) sendText(response, 500, 'The Host failed to answer that.');
  else response.end();
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, BIND_ADDRESS, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        fail(new Error('The Host listened on no port it can name.'));
        return;
      }
      server.removeListener('error', fail);
      done(address.port);
    });
  });
}
