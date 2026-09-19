/**
 * The Supervisor: every Plugin Server the Host starts, and the truth about
 * each one.
 *
 * At start, every Registry row whose directory holds an executable named `mcp`
 * is spawned and kept for the life of the Host. A Plugin Server that exits
 * leaves its Plugin Stopped and is never started again: a broken Plugin must
 * stay visible rather than spin in a restart loop behind the operator's back.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { speak, type PluginServer } from './mcp.ts';
import type { PluginRow } from './registry.ts';

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

export async function superviseAll(
  plugins: readonly PluginRow[],
  handshakeMs: number,
): Promise<Supervisor> {
  const servers = new Map<string, PluginServer>();
  const shipsNone = new Set<string>();

  await Promise.all(
    plugins.map(async (plugin) => {
      const server = await startOne(plugin, shipsNone, handshakeMs);
      if (server !== null) servers.set(plugin.name, server);
    }),
  );

  return {
    stateOf(name) {
      if (shipsNone.has(name)) return 'no-plugin-server';
      const server = servers.get(name);
      return server !== undefined && server.alive() ? 'running' : 'stopped';
    },
    serverOf(name) {
      const server = servers.get(name);
      return server !== undefined && server.alive() ? server : null;
    },
    stopAll() {
      for (const server of servers.values()) server.stop();
    },
  };
}

async function startOne(
  plugin: PluginRow,
  shipsNone: Set<string>,
  handshakeMs: number,
): Promise<PluginServer | null> {
  const path = join(plugin.directory, SERVER_FILE);
  const say = onceOnly(plugin.name);

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
  const server = speak(child, plugin.name);
  child.once('error', (cause) => say(cause.message));
  child.once('exit', (code, signal) => say(signal ?? `exit ${code ?? 0}`));

  try {
    await handshake(server, handshakeMs);
  } catch (cause) {
    say(cause instanceof Error ? cause.message : String(cause));
    server.stop();
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
        // The Host answers a Plugin Server that speaks on its own account, so
        // it says so here: a Plugin Server can tell what this Host carries
        // before it asks for anything.
        capabilities: { experimental: { firstmate: {} } },
        clientInfo: { name: 'firstmate', version: '1.0.0' },
      },
    },
    handshakeMs,
  );
  server.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

/**
 * One Plugin becoming Stopped is one line in the journal, however many ways
 * the Host learns of it. It is news, not a failure of the Host: every other
 * Plugin keeps serving.
 */
function onceOnly(name: string): (why: string) => void {
  let said = false;
  return (why) => {
    if (said) return;
    said = true;
    console.error(`FirstMate: the Plugin named ${name} is Stopped: ${why}.`);
  };
}
