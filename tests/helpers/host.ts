/**
 * The one test seam: a real Host, booted against a temporary home directory,
 * driven over the loopback interface exactly as a browser drives it.
 *
 * Nothing here imports a module of the Host. What a test may see is what a
 * browser and the Tray may see: status codes, headers, response bytes, and the
 * files the Host writes into its home directory.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

const TESTS = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY = dirname(TESTS);

/** How long a Host may take to write its runtime file before a test gives up. */
const BOOT_TIMEOUT_MS = 10_000;

/** The same, for the App, which starts a browser engine before the Host is up. */
const APP_BOOT_TIMEOUT_MS = 60_000;

export type Row = {
  readonly name: string;
  /** A directory under tests/fixtures, or an absolute path of its own. */
  readonly directory: string;
  readonly grants?: readonly string[];
};

export type BootOptions = {
  /**
   * Start the packaged App at this path, which `packageApp` wrote, rather
   * than the Host's own entry point. The App holds the same Host, and proving
   * that is the only reason this option exists.
   */
  readonly app?: string;
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

/**
 * The default Place, as a terminal and the Registry name it: this machine,
 * which is `windows` on Windows and `local` anywhere else (ADR-0021).
 */
export const DEFAULT_PLACE = process.platform === 'win32' ? 'windows' : 'local';

/**
 * What a command that needs the Host says when none answers. On Windows there
 * is a Windows to hold the App, and a test machine has none installed, so the
 * sentence says to install it; anywhere else it says only that no Host runs.
 */
export const NO_HOST =
  process.platform === 'win32'
    ? 'the App is not installed. Run firstmate desktop to install it.'
    : 'no Host runs.';

/** The absolute path of a fixture Plugin. */
export function fixture(name: string): string {
  return join(TESTS, 'fixtures', name);
}

/** What each test still has to undo, newest first. */
const undoing = new WeakMap<TestContext, (() => Promise<void>)[]>();

/**
 * Undo this when the test ends, before anything set up earlier is undone.
 *
 * `t.after` runs its jobs in the order they came, so a home made first would
 * be removed while the Host booted into it still ran. Linux does not mind.
 * Windows refuses to remove a directory a process is working in.
 */
function atEnd(t: TestContext, job: () => Promise<void>): void {
  let jobs = undoing.get(t);
  if (jobs === undefined) {
    const list: (() => Promise<void>)[] = [];
    jobs = list;
    undoing.set(t, list);
    t.after(async () => {
      for (const next of list.reverse()) await next();
    });
  }
  jobs.push(job);
}

/** Remove a directory a test made. Windows may still hold it for a moment after a kill. */
function removeDirectory(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/**
 * Whether the Plugin in this directory can still start its Plugin Server: the
 * executable bit on `mcp`, or on Windows the `mcp.cmd` beside it (ADR-0019).
 */
export async function canStart(directory: string): Promise<boolean> {
  if (process.platform === 'win32') {
    return (await stat(join(directory, 'mcp.cmd')).catch(() => null))?.isFile() === true;
  }
  return ((await stat(join(directory, 'mcp'))).mode & 0o111) !== 0;
}

/**
 * A home directory for one test, removed when the test ends.
 */
export async function makeHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'firstmate-test-'));
  atEnd(t, () => removeDirectory(home));
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
  const entry = [join(REPOSITORY, 'packages', 'host', 'src', 'main.ts')];
  const [program, argv] = options.app === undefined ? [process.execPath, entry] : [options.app, []];
  const child = spawn(program, argv, {
    cwd: REPOSITORY,
    env: { ...process.env, FIRSTMATE_HOME: home, FIRSTMATE_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  collectText(child.stdout, (chunk) => (output += chunk));
  collectText(child.stderr, (chunk) => (output += chunk));

  let exited: number | null = null;
  child.once('exit', (code) => (exited = code));

  atEnd(t, () => stop(child));

  const runtime = await waitForRuntimeFile(
    home,
    () => exited,
    () => output,
    options.app === undefined ? BOOT_TIMEOUT_MS : APP_BOOT_TIMEOUT_MS,
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

/**
 * Build the command line's bundle as packing builds it, into a directory of
 * this test's own, and return that directory. It is removed when the test
 * ends. The package's own `dist/` is left to packing, which empties it first.
 */
export async function build(t: TestContext): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'firstmate-build-'));
  atEnd(t, () => removeDirectory(out));
  await completes('The build', pnpm(['run', 'build', '--out-dir', out], inPackage('cli')));
  return out;
}

/**
 * Package the App as a release packages it, installer and all, into a
 * directory of this test's own, and return that directory. It is removed when
 * the test ends. The App's own `out/` is rewritten on the way, as every build
 * of it does.
 */
export async function packageApp(t: TestContext): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'firstmate-app-'));
  atEnd(t, () => removeDirectory(out));
  const argv = ['run', 'package', `--config.directories.output=${out}`];
  await completes('Packaging the App', pnpm(argv, inPackage('desktop')));
  return out;
}

/** Run in one app's directory, and keep only what it says on failure. */
function inPackage(app: string): SpawnOptions {
  return { cwd: join(REPOSITORY, 'apps', app), stdio: ['ignore', 'ignore', 'pipe'] };
}

/** Resolve once a process exits 0, or fail with what it said on its way out. */
function completes(what: string, child: ChildProcess): Promise<void> {
  return new Promise((done, fail) => {
    let stderr = '';
    collectText(child.stderr, (chunk) => (stderr += chunk));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${what} exited ${code}.\n${stderr}`)),
    );
  });
}

/**
 * One run of pnpm. Under `pnpm test` it is the pnpm running the tests, which
 * names itself in `npm_execpath`: a runner's PATH can hold a stale shim. With
 * no such pnpm, it is the one on PATH, which on Windows is `pnpm.cmd`, and
 * Node starts that only through cmd.exe. No word a test passes holds a quote
 * or a `%`.
 */
export function pnpm(argv: readonly string[], options: SpawnOptions): ChildProcess {
  const running = process.env['npm_execpath'];
  if (running !== undefined && /pnpm/i.test(running)) {
    return /\.[cm]?js$/.test(running)
      ? spawn(process.execPath, [running, ...argv], options)
      : spawn(running, argv, options);
  }
  if (process.platform !== 'win32') return spawn('pnpm', argv, options);
  const line = ['pnpm', ...argv].map((word) => `"${word}"`).join(' ');
  return spawn(line, { ...options, shell: true });
}

/** The Registry file, as the Host reads it. */
async function writeRegistry(home: string, rows: readonly Row[]): Promise<void> {
  const plugins = rows.map((row) => ({
    name: row.name,
    directory: resolve(isAbsolute(row.directory) ? row.directory : fixture(row.directory)),
    grants: row.grants ?? [],
  }));
  await writeFile(join(home, 'registry.json'), `${JSON.stringify({ plugins }, null, 2)}\n`);
}

async function waitForRuntimeFile(
  home: string,
  exited: () => number | null,
  output: () => string,
  timeoutMs: number,
): Promise<{ port: number; token: string }> {
  const path = join(home, 'runtime.json');
  const deadline = Date.now() + timeoutMs;
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
      throw new Error(`The Host wrote no runtime file in ${timeoutMs} ms.\n${output()}`);
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
  return run(join(REPOSITORY, 'apps', 'cli', 'src', 'cli.ts'), home, argv, env, input);
}

/**
 * The command line as `build` built it into this directory, run as
 * `firstmate` runs the source. The built command line has to answer what the
 * source answers, and proving that is the only reason this exists.
 */
export function builtFirstmate(built: string): typeof firstmate {
  return (home, argv, env, input) => run(join(built, 'cli.js'), home, argv, env, input);
}

function run(
  program: string,
  home: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
  input?: string,
): Promise<CommandResult> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [program, ...argv], {
      cwd: REPOSITORY,
      // Not inside WSL unless a test says so, so that no command reaches the
      // real Windows of the machine the tests run on.
      env: { ...process.env, WSL_DISTRO_NAME: '', FIRSTMATE_HOME: home, ...env },
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

/** A run of the command line that keeps going until the test stops it. */
export type Running = {
  /** Everything it has written to stdout so far. */
  output(): string;
};

/**
 * Start the command line and leave it running, as `logs -f` runs. It is
 * stopped when the test ends, whatever the test did.
 */
export function firstmateRunning(t: TestContext, home: string, argv: readonly string[]): Running {
  const child = spawn(
    process.execPath,
    [join(REPOSITORY, 'apps', 'cli', 'src', 'cli.ts'), ...argv],
    {
      cwd: REPOSITORY,
      env: { ...process.env, WSL_DISTRO_NAME: '', FIRSTMATE_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  collectText(child.stdout, (chunk) => (stdout += chunk));
  collectText(child.stderr, () => undefined);
  atEnd(t, () => stop(child));
  return { output: () => stdout };
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

/**
 * Stop a Host as its operator would, and wait for it to end.
 *
 * Windows has no signal that asks a process to end: a kill there is at once,
 * and the Plugin Servers under the Host would outlive it, holding its output
 * open. So on Windows the whole tree goes.
 */
async function stop(child: ChildProcess): Promise<void> {
  const ended = once(child);
  if (process.platform === 'win32' && child.pid !== undefined) {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    await once(taskkill);
  } else {
    child.kill('SIGTERM');
  }
  await ended;
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
