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

export type BootOptions = {
  /**
   * Start the Host through `firstmate start` rather than through the Host's
   * own entry point. The Host is the same either way, and proving that is the
   * only reason this option exists.
   */
  readonly viaCommandLine?: boolean;
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

type RawRequest = {
  readonly method?: string;
  /** The request target, sent exactly as written. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Send no cookie, as a stranger would. The Host refuses such a request. */
  readonly anonymous?: boolean;
};

type RawResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/** The absolute path of a fixture Plugin. */
export function fixture(name: string): string {
  return join(TESTS, 'fixtures', name);
}

/**
 * A home directory for one test, removed when the test ends.
 */
export async function makeHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'firstmate-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

/**
 * Wait for a line in the Host's output. A Plugin Server's stderr arrives when
 * the Plugin Server writes it, which is not when the Host answered a request.
 */
export async function until(
  host: Booted,
  pattern: RegExp,
  timeoutMs = 15_000,
): Promise<RegExpExecArray> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = pattern.exec(host.output());
    if (found !== null) return found;
    if (Date.now() > deadline) {
      throw new Error(`the Host never said ${String(pattern)}\n${host.output()}`);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
}

/**
 * Boot a Host with a Registry written for this test. It is stopped and its
 * home directory removed when the test ends, whatever the test did.
 */
export async function bootHost(
  t: TestContext,
  rows: readonly Row[] = [],
  env: Readonly<Record<string, string>> = {},
  options: BootOptions = {},
): Promise<Booted> {
  const home = await makeHome(t);
  await writeRegistry(home, rows);
  return bootHostIn(t, home, env, options);
}

/** Boot a Host against a home directory that already holds what it needs. */
export async function bootHostIn(
  t: TestContext,
  home: string,
  env: Readonly<Record<string, string>> = {},
  options: BootOptions = {},
): Promise<Booted> {
  const entry =
    options.viaCommandLine === true
      ? [join(REPOSITORY, 'src', 'cli.ts'), 'start']
      : [join(REPOSITORY, 'src', 'main.ts')];
  const child = spawn(process.execPath, entry, {
    cwd: REPOSITORY,
    env: { ...process.env, FIRSTMATE_HOME: home, FIRSTMATE_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  collectText(child.stdout, (chunk) => (output += chunk));
  collectText(child.stderr, (chunk) => (output += chunk));

  let exited: number | null = null;
  child.once('exit', (code) => (exited = code));

  t.after(async () => {
    child.kill('SIGTERM');
    await once(child);
  });

  const runtime = await waitForRuntimeFile(
    home,
    () => exited,
    () => output,
  );
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
        // An admitted browser holds the cookie. A test that wants to be a
        // stranger says so, with its own headers or with `raw`.
        headers: { cookie: cookieFor(runtime.token), ...init?.headers },
      }),
    raw: (request) => rawRequest(runtime.port, runtime.token, request),
  };
}

/** The Registry file, as the Host reads it. */
async function writeRegistry(home: string, rows: readonly Row[]): Promise<void> {
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

export type CommandResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * One run of the command line, against a home directory of this test's own.
 * It is a real process, like everything else a test drives here.
 *
 * The environment is the whole of what a test may change about that process,
 * which is how a command is run on a machine the test has arranged: with no
 * display, or with the webview library made unloadable. The input, when there
 * is one, is written to the command and then closed, as a script pipes its
 * answers in; with none, the command reads nothing at all.
 */
export function firstmate(
  home: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
  input?: string,
): Promise<CommandResult> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(REPOSITORY, 'src', 'cli.ts'), ...argv], {
      cwd: REPOSITORY,
      env: { ...process.env, FIRSTMATE_HOME: home, ...env },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) child.stdin?.end(input);
    let stdout = '';
    let stderr = '';
    collectText(child.stdout, (chunk) => (stdout += chunk));
    collectText(child.stderr, (chunk) => (stderr += chunk));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });
}

/** The cookie the Host admits an already-admitted browser with. */
export function cookieFor(token: string): string {
  return `firstmate_token=${token}`;
}

function rawRequest(port: number, token: string, request: RawRequest): Promise<RawResponse> {
  const method = request.method ?? 'GET';
  const body = request.body ?? '';
  const admitted: Record<string, string> =
    request.anonymous === true ? {} : { cookie: cookieFor(token) };
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...admitted,
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
    // Write without closing this end. A client that half-closes makes the
    // server end its own side at once, which would cut a response the Host is
    // still reading off disk. `Connection: close` is what ends this socket.
    const socket = connect(port, '127.0.0.1', () => socket.write(lines.join('\r\n')));
    let received = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy(new Error('the Host did not answer')));
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

/**
 * Read one output stream of a spawned process as text, chunk by chunk.
 *
 * `stdio: ['ignore', 'pipe', 'pipe']` guarantees Node gives back a stream, but
 * the type is still nullable; this fails loudly instead of asserting past it.
 */
function collectText(stream: NodeJS.ReadableStream | null, add: (chunk: string) => void): void {
  if (stream === null) throw new Error('The spawned process has no stream to read output from.');
  stream.setEncoding('utf8').on('data', (chunk: string) => add(chunk));
}
