/**
 * Where the Host keeps its state, which port it listens on, how long a Plugin
 * Server has to say hello, and where a fetched Plugin lands.
 *
 * The first three come from the environment alone. The Shelf does not, and
 * this module no longer promises that everything it hands back does: the
 * environment moves the Shelf, but an operator who has set none has the one
 * they chose from a terminal, out of the settings file, and a directory under
 * the home when they have chosen nothing at all (ADR-0012).
 *
 * The home directory override is what lets a test boot a real Host against a
 * temporary directory, which is the single seam this project tests through.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readShelf } from './shelf.ts';

/** The environment variable that moves the Host's home directory. */
export const HOME_VARIABLE = 'FIRSTMATE_HOME';

/** The environment variable that moves the Host's port. */
export const PORT_VARIABLE = 'FIRSTMATE_PORT';

/** The environment variable that moves the handshake a Plugin Server must answer. */
export const HANDSHAKE_VARIABLE = 'FIRSTMATE_HANDSHAKE_MS';

/** The fixed port, so that the address is predictable and can be bookmarked. */
export const DEFAULT_PORT = 4747;

/**
 * How long a Plugin Server has to answer `initialize` before it is Stopped.
 *
 * Ten seconds is generous on purpose: a Plugin Server may be a script in a
 * language that takes its time to start, and a slow Plugin is not a broken
 * one. It moves for the same reason the port does — proving that a silent
 * Plugin Server ends up Stopped would otherwise cost a test all ten seconds.
 */
export const DEFAULT_HANDSHAKE_MS = 10_000;

/** The one address the Host answers on. Nothing else on the network reaches it. */
export const BIND_ADDRESS = '127.0.0.1';

export type Config = {
  /** The absolute path of the Host's home directory. */
  readonly home: string;
  /** The port to listen on. Zero asks the system for a free one. */
  readonly port: number;
  /** How long a Plugin Server has to answer the handshake. */
  readonly handshakeMs: number;
  /** The Shelf: the directory a fetched Plugin lands in. */
  readonly shelf: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = readHome(env);
  return {
    home,
    port: readPort(env),
    handshakeMs: readHandshake(env),
    shelf: readShelf(home, env),
  };
}

function readHome(env: NodeJS.ProcessEnv): string {
  const given = env[HOME_VARIABLE];
  if (given === undefined || given === '') {
    return resolve(homedir(), '.firstmate');
  }
  return resolve(given);
}

function readPort(env: NodeJS.ProcessEnv): number {
  const given = env[PORT_VARIABLE];
  if (given === undefined || given === '') {
    return DEFAULT_PORT;
  }
  const port = Number(given);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `${PORT_VARIABLE} must be a whole number from 0 to 65535, not ${JSON.stringify(given)}.`,
    );
  }
  return port;
}

function readHandshake(env: NodeJS.ProcessEnv): number {
  const given = env[HANDSHAKE_VARIABLE];
  if (given === undefined || given === '') {
    return DEFAULT_HANDSHAKE_MS;
  }
  const ms = Number(given);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(
      `${HANDSHAKE_VARIABLE} must be a whole number of milliseconds above zero, ` +
        `not ${JSON.stringify(given)}.`,
    );
  }
  return ms;
}
