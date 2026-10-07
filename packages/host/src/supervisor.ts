/**
 * The Supervisor: every Plugin Server the Host starts, and the truth about
 * each one.
 *
 * At start, every Registry row whose directory holds a Plugin Server file is
 * spawned and kept until the Plugin leaves the Registry or the Host stops. The
 * file is `mcp.ts` or `mcp.js`, which the Host's own Node runs (ADR-0028), or
 * else an executable `mcp`, which on Windows is `mcp.exe` or `mcp.cmd` instead
 * (ADR-0019). A Plugin in a `wsl` Place keeps its `mcp`, and runs inside its
 * distribution through `wsl.exe` (ADR-0021).
 * A reload starts the Plugins added and stops the ones removed, and leaves
 * every other one alone. A Plugin Server that exits leaves its Plugin Stopped
 * and is never started again on the Host's own account: a broken Plugin must
 * stay visible rather than spin in a restart loop behind the operator's back.
 * It does not go quietly all the same: the Host puts a Notice on the queue, so
 * that the operator learns of it without opening the Index Page (ADR-0014).
 *
 * The Supervisor also looks, once, whether each Plugin ships a Plugin Page,
 * and keeps the answer until the next reload or restart. No request makes a
 * file check of its own: in the App the Host shares the main process with the
 * window and the Tray, and for a Plugin in a `wsl` Place the check crosses
 * into the distribution.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WSL_EXE } from '@firstmate/core/wsl';
import { webRoot } from './static-files.ts';
import { speak, type Answering, type PluginServer } from './mcp.ts';
import { SEND_NOTICE, type Notices } from './notices.ts';
import type { HeldPlugin } from '@firstmate/core/plugin-places';
import type { PluginState, Restarted } from '@firstmate/core/plugin-state';
import { openToolBus } from './tool-bus.ts';

/**
 * How the Host starts a Plugin Server file. The file's name decides it, once,
 * where the Host finds the file; the start reads only this.
 */
type ServerForm =
  /** The Host's own Node, with the file as its one argument (ADR-0028). */
  | 'node'
  /** cmd.exe, which alone starts a `.cmd` file (ADR-0019). */
  | 'cmd'
  /** The file itself, as a program. */
  | 'executable';

/** A file a Plugin can ship its Plugin Server as, and how the Host starts it. */
type ServerFileName = { readonly name: string; readonly form: ServerForm };

/**
 * The executable a Plugin ships its Plugin Server as, where its shebang picks
 * the language. There is no manifest.
 */
const EXECUTABLE_SERVER_FILE = {
  name: 'mcp',
  form: 'executable',
} as const satisfies ServerFileName;

/**
 * What a Plugin ships its Plugin Server as for the Host's own Node, in the
 * order the Host looks, before any other form. One file runs on every system,
 * and needs no Node but the one that runs the Host (ADR-0028).
 */
const NODE_SERVER_FILES: readonly ServerFileName[] = [
  { name: 'mcp.ts', form: 'node' },
  { name: 'mcp.js', form: 'node' },
];

/**
 * What a Plugin ships its Plugin Server as on Windows, in the order the Host
 * looks. Windows runs no file by its first line, so the form says how it runs
 * (ADR-0019).
 */
const WINDOWS_SERVER_FILES: readonly ServerFileName[] = [
  { name: 'mcp.exe', form: 'executable' },
  { name: 'mcp.cmd', form: 'cmd' },
];

/** Whether the Host runs on Windows, where a Plugin Server starts another way. */
const ON_WINDOWS = process.platform === 'win32';

/**
 * The Node every Plugin Server is told about, so that a Node Plugin needs no
 * Node of its own: the one that runs the Host (ADR-0019).
 */
const NODE_VARIABLE = 'FIRSTMATE_NODE';

/**
 * How long a Plugin Server the operator restarts has to end before the Host
 * kills it. The new one is not started beside the old: two of one Plugin would
 * share its files.
 */
const STOP_GRACE_MS = 5_000;

/** The MCP version the Host asks for when it starts a Plugin Server. */
const PROTOCOL_VERSION = '2025-06-18';

/** The Plugin Servers of one run, and the way to change them or stop them all. */
export type Supervisor = {
  /** Every Plugin the Host holds now, in the order the Registry gave them. */
  plugins(): readonly HeldPlugin[];
  stateOf(name: string): PluginState;
  serverOf(name: string): PluginServer | null;
  /** Whether the Plugin shipped a Plugin Page when the Host last looked. */
  hasPage(name: string): boolean;
  /**
   * Hold this Registry from now on. A Plugin added is started, a Plugin
   * removed is stopped, and every other Plugin Server is left alone, Stopped
   * or not: a reload is never how a broken Plugin is started again. It
   * resolves once each added Plugin Server has answered or failed.
   */
  hold(plugins: readonly HeldPlugin[]): Promise<void>;
  /**
   * Stop one Plugin's Plugin Server, whatever its state, and start it again.
   * This is the operator's restart, and the only way a Stopped Plugin runs
   * again. Nothing when the Host holds no Plugin of that name.
   */
  restart(name: string): Promise<Restarted | undefined>;
  /**
   * Ask every Plugin Server to end, and resolve once each has ended or been
   * killed, so that none outlives the Host that started it.
   */
  stopAll(): Promise<void>;
};

/**
 * The two waits the Supervisor holds, in one value rather than as two numbers
 * side by side, because two milliseconds in a row are two things to swap.
 */
export type Waits = {
  /** How long a Plugin Server has to answer the handshake. */
  readonly handshakeMs: number;
  /** The longest the Host will wait for a Plugin Server on a Tool Bus call. */
  readonly maxCallMs: number;
};

/** One start of one Plugin's Plugin Server, and what became of it. */
type Run = {
  /** The Registry row it was started from. */
  readonly row: HeldPlugin;
  /** The Plugin Server, once it has answered the handshake. */
  server: PluginServer | null;
  /** The Plugin ships no Plugin Server at all, which is no failure. */
  shipsNone: boolean;
  /** The Plugin ships a Plugin Page, as the Host last looked. */
  hasPage: boolean;
  /** The process, once one was spawned. */
  child: ChildProcess | null;
  /** Settles once the process has ended, and at once when none was spawned. */
  ended: Promise<void>;
  /** Why the Plugin is Stopped, once it is. */
  why: string | null;
  /**
   * The Host stops this one on purpose, so its end is no news: there is no
   * Notice for the Plugin the operator removed, or for any Plugin when the
   * Host itself stops.
   */
  quiet: boolean;
};

/** Start every Plugin Server in the Registry, and resolve once each has answered or failed. */
export async function superviseAll(
  plugins: readonly HeldPlugin[],
  waits: Waits,
  notices: Notices,
): Promise<Supervisor> {
  let held: readonly HeldPlugin[] = [];
  const runs = new Map<string, Run>();

  const stateOf = (name: string): PluginState => {
    const run = runs.get(name);
    if (run?.shipsNone === true) return 'no-plugin-server';
    return run?.server?.alive() === true ? 'running' : 'stopped';
  };
  const serverOf = (name: string): PluginServer | null => {
    const server = runs.get(name)?.server ?? null;
    return server?.alive() === true ? server : null;
  };

  // The Tool Bus is opened over this same map, which is still empty. A call is
  // resolved when it arrives, so every Plugin Server can reach every other one
  // however they were ordered at start.
  const bus = openToolBus(held, { stateOf, serverOf }, waits.maxCallMs);

  const start = (plugin: HeldPlugin): Promise<Run> => {
    const toolBus = bus.answering(plugin.name);
    // A Notice is not a Tool Bus call, so it never passes the Grant check:
    // every Plugin may send one, under the gap between two (ADR-0014).
    const answering: Answering = (method, params) =>
      method === SEND_NOTICE
        ? Promise.resolve(notices.send(plugin.name, params))
        : toolBus(method, params);
    return startOne(plugin, waits.handshakeMs, answering, notices, spawned);
  };

  // Every process the Host has spawned and not yet seen end, including one
  // still in its handshake, which is in no map yet. Stopping the Host stops
  // them all, and a process spawned after that is stopped as it starts, so no
  // Plugin Server outlives the Host that started it.
  const live = new Set<Run>();
  let stopping = false;
  const spawned = (run: Run): void => {
    live.add(run);
    void run.ended.then(() => live.delete(run));
    if (stopping) void quit(run);
  };

  // A Plugin that leaves is stopped, and ended, before anything new starts:
  // the same Plugin added back must never run beside its old self.
  const retire = async (name: string): Promise<void> => {
    const run = runs.get(name);
    if (run === undefined) return;
    runs.delete(name);
    run.quiet = true;
    await end(run);
  };

  // One change at a time. Two reloads that crossed would each start what the
  // other had already started.
  let turn: Promise<void> = Promise.resolve();
  const inTurn = (job: () => Promise<void>): Promise<void> => {
    const done = turn.then(job);
    turn = done.catch(() => undefined);
    return done;
  };

  const hold = (next: readonly HeldPlugin[]): Promise<void> =>
    inTurn(async () => {
      // A Plugin is the same Plugin while its name, its Place and its
      // directory are. One moved to another directory, or to another Place,
      // or whose Place now reads it from elsewhere, is another Plugin under
      // an old name.
      const same = (row: HeldPlugin): boolean => {
        const held = runs.get(row.name)?.row;
        return (
          held?.directory === row.directory &&
          held.place === row.place &&
          held.files === row.files &&
          JSON.stringify(held.runner) === JSON.stringify(row.runner)
        );
      };
      const staying = next.filter(same);
      // A Plugin that stays may still have gained or lost its web directory,
      // and a reload is when the Host looks again.
      await Promise.all(
        staying.map(async (row) => {
          const run = runs.get(row.name);
          if (run !== undefined) run.hasPage = await shipsPage(row);
        }),
      );
      const leaving = held.filter((row) => !staying.some((kept) => kept.name === row.name));

      // The Host stops serving a Plugin before it stops the Plugin Server, so
      // that nothing new reaches a Plugin Server on its way out.
      held = held.filter((row) => !leaving.includes(row));
      bus.hold(held);
      await Promise.all(leaving.map((row) => retire(row.name)));

      const started = await Promise.all(next.filter((row) => !same(row)).map(start));
      for (const run of started) runs.set(run.row.name, run);
      held = next;
      bus.hold(held);
    });

  const restart = async (name: string): Promise<Restarted | undefined> => {
    let restarted: Restarted | undefined;
    await inTurn(async () => {
      const row = held.find((plugin) => plugin.name === name);
      const old = runs.get(name);
      if (row === undefined || old === undefined) return;
      old.quiet = true;
      await end(old);
      const run = await start(row);
      runs.set(name, run);
      // A Plugin Server that failed is still on its way out, and says why as
      // it goes. The operator asked, so the operator hears it.
      if (run.server === null && !run.shipsNone) await ended(run);
      restarted =
        run.why === null ? { state: stateOf(name) } : { state: stateOf(name), why: run.why };
    });
    return restarted;
  };

  await hold(plugins);

  return {
    plugins: () => held,
    stateOf,
    serverOf,
    hasPage: (name) => runs.get(name)?.hasPage === true,
    hold,
    restart,
    async stopAll() {
      stopping = true;
      await Promise.all([...live].map(quit));
    },
  };
}

/** End a run's process as the Host stops: its end is no news. */
function quit(run: Run): Promise<void> {
  run.quiet = true;
  return end(run);
}

/**
 * Ask a run's process to end, and kill it if it will not in time.
 *
 * Closing its stdin is how MCP over stdio asks a server to end, and on Windows
 * it is the only way to ask: a signal there kills at once. So Windows gets the
 * same grace, and then the whole tree goes, because a Plugin Server started
 * from `mcp.cmd` is cmd.exe with the real program under it (ADR-0019).
 */
async function end(run: Run): Promise<void> {
  run.server?.stop();
  if (!ON_WINDOWS) run.child?.kill('SIGTERM');
  if (!(await ended(run))) {
    killHard(run.child);
    await run.ended;
  }
}

/** Kill a process that would not end, and on Windows every process under it. */
function killHard(child: ChildProcess | null): void {
  if (child === null) return;
  if (!ON_WINDOWS || child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  // taskkill missing, or the tree already gone: the process itself still goes.
  taskkill.once('error', () => child.kill('SIGKILL'));
  taskkill.once('exit', (code) => {
    if (code !== 0) child.kill('SIGKILL');
  });
}

/** Whether a run's process ends within the grace the Host gives it. */
function ended(run: Run): Promise<boolean> {
  return Promise.race([run.ended.then(() => true), delay(STOP_GRACE_MS, false, { ref: false })]);
}

async function startOne(
  plugin: HeldPlugin,
  handshakeMs: number,
  answering: Answering,
  notices: Notices,
  spawned: (run: Run) => void,
): Promise<Run> {
  const run: Run = {
    row: plugin,
    server: null,
    shipsNone: false,
    hasPage: await shipsPage(plugin),
    child: null,
    ended: Promise.resolve(),
    why: null,
    quiet: false,
  };
  const say = onceOnly(plugin.name, (why) => {
    run.why = why;
    if (!run.quiet) notices.fromHost(`${plugin.name} is Stopped`, stoppedBody(plugin.name, why));
  });

  if (plugin.runner.kind === 'nowhere') {
    say(plugin.runner.why);
    return run;
  }
  const file = await serverFile(plugin);
  if (file.found === 'none') {
    // No Plugin Server file: this Plugin ships no Plugin Server, which is
    // allowed and is not a failure.
    run.shipsNone = true;
    return run;
  }
  if (file.found === 'unrunnable') {
    say(file.why);
    return run;
  }

  const child = launch(file, plugin);
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  // The calling Plugin Name is this pipe's, closed over here and never taken
  // from anything the Plugin Server says.
  const server = speak(child, plugin.name, answering);
  child.once('error', (cause) => say(cause.message));
  child.once('exit', (code, signal) => say(signal ?? `exit ${code ?? 0}`));
  run.child = child;
  // Heard after the two above, so a run that has ended has said why.
  run.ended = new Promise((done) => {
    child.once('exit', () => done());
    child.once('error', () => done());
  });
  spawned(run);

  try {
    await handshake(server, handshakeMs);
  } catch (cause) {
    // When the pipe broke first, the process is gone or going, and its exit
    // says why better than the broken pipe does: "exit 3" is what the
    // operator can act on. Either way it is ended, because a process that
    // will not answer, or that closed its end, may still live.
    if (server.alive()) say(cause instanceof Error ? cause.message : String(cause));
    void end(run);
    // A Plugin Server that never finished the handshake is one the Host
    // cannot forward a call to, so the Plugin is Stopped from the start.
    return run;
  }
  console.log(`FirstMate: the Plugin Server of ${plugin.name} is running.`);
  run.server = server;
  return run;
}

/** A Plugin Server file the Host can start, and how it starts it. */
type Runnable = {
  readonly found: 'runnable';
  readonly path: string;
  readonly form: ServerForm;
};

/** What a Plugin directory holds to start a Plugin Server from. */
type ServerFile =
  /** Nothing: the Plugin ships no Plugin Server. */
  | { readonly found: 'none' }
  /** A file the Host cannot start, and why. */
  | { readonly found: 'unrunnable'; readonly why: string }
  /** A file the Host can start. */
  | Runnable;

/** Find the file a Plugin ships its Plugin Server as, where its Plugin Server runs. */
async function serverFile(plugin: HeldPlugin): Promise<ServerFile> {
  const directory = plugin.files;
  // A wsl Place's files are read through its root, and a root that cannot be
  // read is a distribution that is missing or will not start.
  if (plugin.runner.kind === 'wsl' && (await stat(directory).catch(() => null)) === null) {
    return {
      found: 'unrunnable',
      why:
        `${directory} cannot be read. Is the distribution ` +
        `${plugin.runner.distribution} there, and does it start?`,
    };
  }
  const executablePath = join(directory, EXECUTABLE_SERVER_FILE.name);
  const executable: Runnable = {
    found: 'runnable',
    path: executablePath,
    form: EXECUTABLE_SERVER_FILE.form,
  };
  const forNode = await firstFile(directory, NODE_SERVER_FILES);
  if (plugin.runner.kind === 'wsl') {
    // Its `mcp` is run inside the distribution, which alone knows its
    // executable bit.
    if (await isFile(executablePath)) return executable;
    // A Plugin Server for the Host's Node is a Plugin Server all the same, so
    // the Plugin is Stopped, not shipping none. The Host's Node is a Windows
    // program, and is not handed across (ADR-0021, ADR-0028).
    return forNode === null
      ? { found: 'none' }
      : { found: 'unrunnable', why: `${forNode.path} cannot run in a wsl Place, which starts mcp` };
  }
  if (forNode !== null) return forNode;
  if (ON_WINDOWS) {
    const forWindows = await firstFile(directory, WINDOWS_SERVER_FILES);
    if (forWindows !== null) return forWindows;
    // An `mcp` alone is a Plugin Server written for Linux. It is a Plugin
    // Server all the same, so the Plugin is Stopped, not shipping none.
    // mcp.ts comes first in the sentence: it is the one form that runs here
    // and on Linux alike (ADR-0028).
    return (await isFile(executablePath))
      ? {
          found: 'unrunnable',
          why: `${executablePath} cannot run on Windows: it needs mcp.ts, mcp.cmd or mcp.exe`,
        }
      : { found: 'none' };
  }
  if (!(await isFile(executablePath))) return { found: 'none' };
  const runnable = await access(executablePath, constants.X_OK).then(
    () => true,
    () => false,
  );
  return runnable
    ? executable
    : { found: 'unrunnable', why: `${executablePath} is not executable` };
}

/** Whether a Plugin ships a Plugin Page: a web directory, read through its Place. */
async function shipsPage(plugin: HeldPlugin): Promise<boolean> {
  return (await stat(webRoot(plugin.files)).catch(() => null)) !== null;
}

/** The first of these files the directory holds, in this order, or null for none. */
async function firstFile(
  directory: string,
  names: readonly ServerFileName[],
): Promise<Runnable | null> {
  for (const { name, form } of names) {
    const path = join(directory, name);
    if (await isFile(path)) return { found: 'runnable', path, form };
  }
  return null;
}

async function isFile(path: string): Promise<boolean> {
  const found = await stat(path).catch(() => null);
  return found?.isFile() === true;
}

/**
 * Spawn a Plugin Server.
 *
 * It runs in its own Plugin's directory, so that it reaches its own files by
 * the relative paths its author already wrote. stdin and stdout carry MCP.
 * stderr is the Plugin Server's own output, and the Host writes it as its
 * own, so it reaches the terminal and the log alike (log.ts). It is piped
 * rather than inherited because the App has no console to inherit.
 */
function launch(file: Runnable, plugin: HeldPlugin): ChildProcess {
  const options = {
    cwd: plugin.files,
    env: {
      ...process.env,
      [NODE_VARIABLE]: process.execPath,
      // In the App, process.execPath is the App, which runs as Node only when told (ADR-0020).
      ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  } satisfies SpawnOptions;
  if (plugin.runner.kind === 'wsl') {
    // The distribution starts it in its own directory, by its own path, so
    // wsl.exe needs no working directory of the Host's. The Node the Host
    // names is a Windows program, and is not handed across (ADR-0021).
    return spawn(
      WSL_EXE,
      [
        '-d',
        plugin.runner.distribution,
        '--cd',
        plugin.directory,
        '--',
        `./${EXECUTABLE_SERVER_FILE.name}`,
      ],
      { ...options, cwd: undefined },
    );
  }
  switch (file.form) {
    case 'node':
      // The Host's own Node, with the file as its one argument, and no shell: a
      // Plugin Server is started the same way on every system (ADR-0028).
      return spawn(process.execPath, [basename(file.path)], options);
    case 'executable':
      return spawn(file.path, [], options);
    case 'cmd':
      // Node starts a `.cmd` file only through cmd.exe, and only when asked to
      // (CVE-2024-27980). cmd.exe reads a command line by rules of its own, so it
      // is handed no path to read: from the Plugin's own directory, `.\\mcp.cmd`
      // holds no space and nothing cmd.exe treats as special (ADR-0019).
      return spawn('.\\mcp.cmd', [], { ...options, shell: true });
  }
}

/**
 * The MCP handshake. A Plugin Server that will not answer it is not a Plugin
 * Server the Host can forward a tool call to, so the Plugin is Stopped. One
 * that is merely slow is given until `handshakeMs`, because a slow Plugin is
 * not a broken one.
 */
async function handshake(server: PluginServer, handshakeMs: number): Promise<void> {
  await server.call(
    {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        // MCP keeps what its specification does not name under `experimental`.
        // The Host answers a Plugin Server that speaks on its own account, and
        // what it carries is the Tool Bus and the Notice, so it says so here: a
        // Plugin Server can tell what this Host offers before it asks for
        // anything.
        capabilities: { experimental: { firstmate: { toolBus: {}, notice: {} } } },
        clientInfo: { name: 'firstmate', version: '1.0.0' },
      },
    },
    handshakeMs,
  );
  server.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

/**
 * One Plugin becoming Stopped is one line in the log and one Notice,
 * however many ways the Host learns of it. It is news, not a failure of the
 * Host: every other Plugin keeps serving.
 */
/**
 * What a Stopped Notice says: what happened, in words a person reads, and the
 * two commands that come next. The reason itself stays short, because
 * `/plugins.json` and `firstmate status` say it as it is.
 */
function stoppedBody(name: string, why: string): string {
  const exit = /^exit (\d+)\.$/.exec(why);
  const signal = /^(SIG[A-Z0-9]+)\.$/.exec(why);
  const what =
    exit !== null
      ? `Its Plugin Server ended with exit code ${exit[1]}.`
      : signal !== null
        ? `Its Plugin Server was ended by ${signal[1]}.`
        : `${why.charAt(0).toUpperCase()}${why.slice(1)}`;
  return `${what} firstmate logs says more, and firstmate restart ${name} starts it again.`;
}

function onceOnly(name: string, stopped: (why: string) => void): (why: string) => void {
  let said = false;
  return (why) => {
    if (said) return;
    said = true;
    console.error(`FirstMate: the Plugin named ${name} is Stopped: ${why}.`);
    // A reason may already end with a full stop, and a body needs just one.
    stopped(`${why.replace(/\.$/, '')}.`);
  };
}
