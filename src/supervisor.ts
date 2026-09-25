/**
 * The Supervisor: every Plugin Server the Host starts, and the truth about
 * each one.
 *
 * At start, every Registry row whose directory holds an executable named `mcp`
 * is spawned and kept for the life of the Host. A Plugin Server that exits
 * leaves its Plugin Stopped and is never started again: a broken Plugin must
 * stay visible rather than spin in a restart loop behind the operator's back.
 * It does not go quietly all the same: the Host puts a Notice on the queue, so
 * that the operator learns of it without opening the Index Page (ADR-0014).
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { speak, type Answering, type PluginServer } from './mcp.ts';
import { SEND_NOTICE, type Notices } from './notices.ts';
import type { PluginRow } from './registry.ts';
import { openToolBus } from './tool-bus.ts';

/** The executable a Plugin ships its Plugin Server as. There is no manifest. */
export const SERVER_FILE = 'mcp';

/** The MCP version the Host asks for when it starts a Plugin Server. */
const PROTOCOL_VERSION = '2025-06-18';

export type PluginState =
  /** The Plugin Server is up and has answered the handshake. */
  | 'running'
  /** The Plugin Server is no longer running, or never started. */
  | 'stopped'
  /** The Plugin ships no Plugin Server at all. */
  | 'no-plugin-server';

export type Supervisor = {
  stateOf(name: string): PluginState;
  serverOf(name: string): PluginServer | null;
  stopAll(): void;
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

export async function superviseAll(
  plugins: readonly PluginRow[],
  waits: Waits,
  notices: Notices,
): Promise<Supervisor> {
  const servers = new Map<string, PluginServer>();
  const shipsNone = new Set<string>();
  // A Plugin Server the Host stops on its way out is not news, so it sends no
  // Notice: there is no Host left for a click to open.
  let stopping = false;
  const stopped = (name: string, why: string): void => {
    if (!stopping) notices.fromHost(`${name} is Stopped`, why);
  };

  const stateOf = (name: string): PluginState => {
    if (shipsNone.has(name)) return 'no-plugin-server';
    const server = servers.get(name);
    return server !== undefined && server.alive() ? 'running' : 'stopped';
  };
  const serverOf = (name: string): PluginServer | null => {
    const server = servers.get(name);
    return server !== undefined && server.alive() ? server : null;
  };

  // The Tool Bus is opened over this same map, which is still empty. A call is
  // resolved when it arrives, so every Plugin Server can reach every other one
  // however they were ordered at start.
  const bus = openToolBus(plugins, { stateOf, serverOf }, waits.maxCallMs);

  await Promise.all(
    plugins.map(async (plugin) => {
      const toolBus = bus.answering(plugin.name);
      // A Notice is not a Tool Bus call, so it never passes the Grant check:
      // every Plugin may send one, under the gap between two (ADR-0014).
      const answering: Answering = (method, params) =>
        method === SEND_NOTICE
          ? Promise.resolve(notices.send(plugin.name, params))
          : toolBus(method, params);
      const server = await startOne(plugin, shipsNone, waits.handshakeMs, answering, stopped);
      if (server !== null) servers.set(plugin.name, server);
    }),
  );

  return {
    stateOf,
    serverOf,
    stopAll() {
      stopping = true;
      for (const server of servers.values()) server.stop();
    },
  };
}

async function startOne(
  plugin: PluginRow,
  shipsNone: Set<string>,
  handshakeMs: number,
  answering: Answering,
  stopped: (name: string, why: string) => void,
): Promise<PluginServer | null> {
  const path = join(plugin.directory, SERVER_FILE);
  const say = onceOnly(plugin.name, stopped);

  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) {
    // No `mcp` file: this Plugin ships no Plugin Server, which is allowed and
    // is not a failure.
    shipsNone.add(plugin.name);
    return null;
  }
  const runnable = await access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
  if (!runnable) {
    say(`${path} is not executable`);
    return null;
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
    return null;
  }
  console.log(`FirstMate: the Plugin Server of ${plugin.name} is running.`);
  return server;
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
function onceOnly(
  name: string,
  stopped: (name: string, why: string) => void,
): (why: string) => void {
  let said = false;
  return (why) => {
    if (said) return;
    said = true;
    console.error(`FirstMate: the Plugin named ${name} is Stopped: ${why}.`);
    // A reason may already end with a full stop, and a body needs just one.
    stopped(name, `${why.replace(/\.$/, '')}.`);
  };
}
