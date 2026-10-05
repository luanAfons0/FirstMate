/**
 * The Supervisor: every Plugin Server the Host starts, and the truth about
 * each one.
 *
 * At start, every Registry row whose directory holds an executable named `mcp`
 * is spawned and kept until the Plugin leaves the Registry or the Host stops.
 * A reload starts the Plugins added and stops the ones removed, and leaves
 * every other one alone. A Plugin Server that exits leaves its Plugin Stopped
 * and is never started again on the Host's own account: a broken Plugin must
 * stay visible rather than spin in a restart loop behind the operator's back.
 * It does not go quietly all the same: the Host puts a Notice on the queue, so
 * that the operator learns of it without opening the Index Page (ADR-0014).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { speak, type Answering, type PluginServer } from './mcp.ts';
import { SEND_NOTICE, type Notices } from './notices.ts';
import type { PluginRow } from '@firstmate/core/registry';
import { openToolBus } from './tool-bus.ts';

/** The executable a Plugin ships its Plugin Server as. There is no manifest. */
const SERVER_FILE = 'mcp';

/**
 * How long a Plugin Server the operator restarts has to end before the Host
 * kills it. The new one is not started beside the old: two of one Plugin would
 * share its files.
 */
const STOP_GRACE_MS = 5_000;

/** The MCP version the Host asks for when it starts a Plugin Server. */
const PROTOCOL_VERSION = '2025-06-18';

/** What the Host knows about a Plugin's Plugin Server. */
export type PluginState =
  /** The Plugin Server is up and has answered the handshake. */
  | 'running'
  /** The Plugin Server is no longer running, or never started. */
  | 'stopped'
  /** The Plugin ships no Plugin Server at all. */
  | 'no-plugin-server';

/** The Plugin Servers of one run, and the way to change them or stop them all. */
export type Supervisor = {
  /** Every Plugin the Host holds now, in the order the Registry gave them. */
  plugins(): readonly PluginRow[];
  stateOf(name: string): PluginState;
  serverOf(name: string): PluginServer | null;
  /**
   * Hold this Registry from now on. A Plugin added is started, a Plugin
   * removed is stopped, and every other Plugin Server is left alone, Stopped
   * or not: a reload is never how a broken Plugin is started again. It
   * resolves once each added Plugin Server has answered or failed.
   */
  hold(plugins: readonly PluginRow[]): Promise<void>;
  /**
   * Stop one Plugin's Plugin Server, whatever its state, and start it again.
   * This is the operator's restart, and the only way a Stopped Plugin runs
   * again. Nothing when the Host holds no Plugin of that name.
   */
  restart(name: string): Promise<Restarted | undefined>;
  stopAll(): void;
};

/** What became of a Plugin the operator restarted. */
export type Restarted = {
  readonly state: PluginState;
  /** Why it is Stopped, when it is. */
  readonly why?: string;
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
  readonly row: PluginRow;
  /** The Plugin Server, once it has answered the handshake. */
  server: PluginServer | null;
  /** The Plugin ships no Plugin Server at all, which is no failure. */
  shipsNone: boolean;
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
  plugins: readonly PluginRow[],
  waits: Waits,
  notices: Notices,
): Promise<Supervisor> {
  let held: readonly PluginRow[] = [];
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

  const start = (plugin: PluginRow): Promise<Run> => {
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
    if (stopping) quit(run);
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

  const hold = (next: readonly PluginRow[]): Promise<void> =>
    inTurn(async () => {
      // A Plugin is the same Plugin while its name and its directory are. One
      // moved to another directory is another Plugin under an old name.
      const same = (row: PluginRow): boolean => runs.get(row.name)?.row.directory === row.directory;
      const staying = next.filter(same);
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
    hold,
    restart,
    stopAll() {
      stopping = true;
      for (const run of live) quit(run);
    },
  };
}

/** Ask a run's process to end, as the Host stops: its end is no news. */
function quit(run: Run): void {
  run.quiet = true;
  run.server?.stop();
  run.child?.kill('SIGTERM');
}

/** Ask a run's process to end, and kill it if it will not in time. */
async function end(run: Run): Promise<void> {
  run.server?.stop();
  run.child?.kill('SIGTERM');
  if (!(await ended(run))) {
    run.child?.kill('SIGKILL');
    await run.ended;
  }
}

/** Whether a run's process ends within the grace the Host gives it. */
function ended(run: Run): Promise<boolean> {
  return Promise.race([run.ended.then(() => true), delay(STOP_GRACE_MS, false, { ref: false })]);
}

async function startOne(
  plugin: PluginRow,
  handshakeMs: number,
  answering: Answering,
  notices: Notices,
  spawned: (run: Run) => void,
): Promise<Run> {
  const run: Run = {
    row: plugin,
    server: null,
    shipsNone: false,
    child: null,
    ended: Promise.resolve(),
    why: null,
    quiet: false,
  };
  const path = join(plugin.directory, SERVER_FILE);
  const say = onceOnly(plugin.name, (why) => {
    run.why = why;
    if (!run.quiet) notices.fromHost(`${plugin.name} is Stopped`, why);
  });

  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) {
    // No `mcp` file: this Plugin ships no Plugin Server, which is allowed and
    // is not a failure.
    run.shipsNone = true;
    return run;
  }
  const runnable = await access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
  if (!runnable) {
    say(`${path} is not executable`);
    return run;
  }

  const child = spawn(path, [], {
    // A Plugin Server runs in its own Plugin's directory, so that it reaches
    // its own files by the relative paths its author already wrote.
    cwd: plugin.directory,
    // stdin and stdout carry MCP. stderr is the Plugin Server's own output and
    // goes straight to the Host's, which under systemd is the journal.
    stdio: ['pipe', 'pipe', 'inherit'],
  });
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
    if (server.alive()) {
      say(cause instanceof Error ? cause.message : String(cause));
      server.stop();
    } else {
      // The pipe broke first, so the process is gone or going. Its exit says
      // why better than the broken pipe does: "exit 3" is what the operator
      // can act on. The kill is for a process that closed its end and lives.
      child.kill('SIGTERM');
    }
    // A Plugin Server that never finished the handshake is one the Host
    // cannot forward a call to, so the Plugin is Stopped from the start.
    return run;
  }
  console.log(`FirstMate: the Plugin Server of ${plugin.name} is running.`);
  run.server = server;
  return run;
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
 * One Plugin becoming Stopped is one line in the journal and one Notice,
 * however many ways the Host learns of it. It is news, not a failure of the
 * Host: every other Plugin keeps serving.
 */
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
