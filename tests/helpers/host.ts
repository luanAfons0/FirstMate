/**
 * The one test seam: a real Host, booted against a temporary home directory,
 * driven over the loopback interface exactly as a browser drives it.
 *
 * Nothing here imports a module of the Host. What a test may see is what a
 * browser and the Tray may see: status codes, headers, response bytes, and the
 * files the Host writes into its home directory.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

const TESTS = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY = dirname(TESTS);

/** How long a Host may take to write its runtime file before a test gives up. */
const BOOT_TIMEOUT_MS = 10_000;

export type Row = {
  readonly name: string;
  /** A directory under tests/fixtures, or an absolute path of its own. */
  readonly directory: string;
  readonly grants?: readonly string[];
};

export type Booted = {
  /** The port the Host actually listened on. */
  readonly port: number;
  /** The token the Host minted at startup. */
  readonly token: string;
  /** The Host's home directory for this test. */
  readonly home: string;
  /** The origin every request goes to. */
  readonly origin: string;
  /** Everything the Host has written to its output so far. */
  output(): string;
  /** One request, following no redirect, so that a test can assert on one. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * One request written byte for byte. A test needs this where a client
   * library will not do as it is told: `Host` is a forbidden header for
   * `fetch`, and a path holding `..` is normalised away before it is sent.
   */
  raw(request: RawRequest): Promise<RawResponse>;
};

export type RawRequest = {
  readonly method?: string;
  /** The request target, sent exactly as written. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type RawResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/** The absolute path of a fixture Plugin. */
export function fixture(name: string): string {
  return join(TESTS, 'fixtures', name);
}

/**
 * Boot a Host with a Registry written for this test. It is stopped and its
 * home directory removed when the test ends, whatever the test did.
 */
export async function bootHost(
  t: TestContext,
  rows: readonly Row[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<Booted> {
  const home = await mkdtemp(join(tmpdir(), 'firstmate-test-'));
  await writeRegistry(home, rows);

  const child = spawn(process.execPath, [join(REPOSITORY, 'src', 'main.ts')], {
    cwd: REPOSITORY,
    env: { ...process.env, FIRSTMATE_HOME: home, FIRSTMATE_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));

  let exited: number | null = null;
  child.once('exit', (code) => (exited = code));

  t.after(async () => {
    child.kill('SIGTERM');
    await once(child);
    await rm(home, { recursive: true, force: true });
  });

  const runtime = await waitForRuntimeFile(home, () => exited, () => output);
  return {
    port: runtime.port,
    token: runtime.token,
    home,
    origin: `http://127.0.0.1:${runtime.port}`,
    output: () => output,
    fetch: (path, init) =>
      fetch(new URL(path, `http://127.0.0.1:${runtime.port}`), {
        redirect: 'manual',
        ...init,
      }),
    raw: (request) => rawRequest(runtime.port, request),
  };
}

/** The Registry file, as the Host reads it. */
export async function writeRegistry(home: string, rows: readonly Row[]): Promise<void> {
  const plugins = rows.map((row) => ({
    name: row.name,
    directory: resolve(row.directory.startsWith('/') ? row.directory : fixture(row.directory)),
    grants: row.grants ?? [],
  }));
  await writeFile(join(home, 'registry.json'), `${JSON.stringify({ plugins }, null, 2)}\n`);
}

async function waitForRuntimeFile(
  home: string,
  exited: () => number | null,
  output: () => string,
): Promise<{ port: number; token: string }> {
  const path = join(home, 'runtime.json');
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    try {
      const runtime = JSON.parse(await readFile(path, 'utf8')) as { port: number; token: string };
      if (typeof runtime.port === 'number' && runtime.port > 0) return runtime;
    } catch {
      // The Host has not written it yet.
    }
    if (exited() !== null) {
      throw new Error(`The Host exited before it listened.\n${output()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`The Host wrote no runtime file in ${BOOT_TIMEOUT_MS} ms.\n${output()}`);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
}

function rawRequest(port: number, request: RawRequest): Promise<RawResponse> {
  const method = request.method ?? 'GET';
  const body = request.body ?? '';
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...request.headers,
    connection: 'close',
  };
  if (body !== '') headers['content-length'] = String(Buffer.byteLength(body));
  const lines = [
    `${method} ${request.path} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ];

  return new Promise((done, fail) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(lines.join('\r\n')));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.once('error', fail);
    socket.once('close', () => done(parseRawResponse(received)));
  });
}

function parseRawResponse(received: string): RawResponse {
  const split = received.indexOf('\r\n\r\n');
  const head = (split < 0 ? received : received.slice(0, split)).split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return {
    status: Number((head[0] ?? '').split(' ')[1] ?? 0),
    headers,
    body: split < 0 ? '' : received.slice(split + 4),
  };
}

function once(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => child.once('exit', () => done()));
}
