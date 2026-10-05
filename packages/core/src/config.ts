/**
 * Where the Host keeps its state, which port it listens on, how long a Plugin
 * Server has to say hello, how long one Plugin may wait on another, how long a
 * Notice lives, and where a fetched Plugin lands.
 *
 * The first five come from the environment alone. The Shelf does not, and
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
const PORT_VARIABLE = 'FIRSTMATE_PORT';

/** The environment variable that moves the handshake a Plugin Server must answer. */
const HANDSHAKE_VARIABLE = 'FIRSTMATE_HANDSHAKE_MS';

/** The environment variable that moves the ceiling on a Tool Bus call. */
const MAX_CALL_VARIABLE = 'FIRSTMATE_MAX_CALL_MS';

/** The environment variable that moves how long the Host holds a Notice. */
const NOTICE_VARIABLE = 'FIRSTMATE_NOTICE_MS';

/** The fixed port, so that the address is predictable and can be bookmarked. */
const DEFAULT_PORT = 4747;

/**
 * How long a Plugin Server has to answer `initialize` before it is Stopped.
 *
 * Ten seconds is generous on purpose: a Plugin Server may be a script in a
 * language that takes its time to start, and a slow Plugin is not a broken
 * one. It moves for the same reason the port does — proving that a silent
 * Plugin Server ends up Stopped would otherwise cost a test all ten seconds.
 */
const DEFAULT_HANDSHAKE_MS = 10_000;

/**
 * The longest the Host will wait for a Plugin Server on a Tool Bus call.
 *
 * Ten minutes is a ceiling and not a default: a call that asks for nothing
 * still gets the thirty seconds it always got, and a call that asks for more
 * than this is quietly given this, because a Plugin should not have to know
 * the Host's number to be allowed to run. It is a variable for the same reason
 * the handshake is one — a test proves the clamp in milliseconds rather than
 * in minutes (ADR-0012 keeps the Shelf in the settings file; this is the other
 * kind of number, which nobody changes).
 */
const DEFAULT_MAX_CALL_MS = 600_000;

/**
 * How long the Host holds a Notice for the Tray to read.
 *
 * A minute is many polls of the Tray, and short enough that a Tray which was
 * not running never finds old news waiting (ADR-0014). It moves so that a test
 * proves the expiry in milliseconds rather than in a minute.
 */
const DEFAULT_NOTICE_MS = 60_000;

/** The one address the Host answers on. Nothing else on the network reaches it. */
export const BIND_ADDRESS = '127.0.0.1';

/** Everything the Host is moved by: the environment, and the one setting it keeps. */
export type Config = {
  /** The absolute path of the Host's home directory. */
  readonly home: string;
  /** The port to listen on. Zero asks the system for a free one. */
  readonly port: number;
  /** How long a Plugin Server has to answer the handshake. */
  readonly handshakeMs: number;
  /** The longest the Host will wait for a Plugin Server on a Tool Bus call. */
  readonly maxCallMs: number;
  /** How long the Host holds a Notice for the Tray to read. */
  readonly noticeMs: number;
  /** The Shelf: the directory a fetched Plugin lands in. */
  readonly shelf: string;
};

/** Read the Config, failing loudly on a variable that holds nonsense. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = readHome(env);
  return {
    home,
    port: readPort(env),
    handshakeMs: readMilliseconds(env, HANDSHAKE_VARIABLE, DEFAULT_HANDSHAKE_MS),
    maxCallMs: readMilliseconds(env, MAX_CALL_VARIABLE, DEFAULT_MAX_CALL_MS),
    noticeMs: readMilliseconds(env, NOTICE_VARIABLE, DEFAULT_NOTICE_MS),
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

/**
 * The longest wait a timer can hold. Node fires a longer one after a single
 * millisecond instead, which would turn a generous setting into no wait at all.
 */
const LONGEST_TIMER_MS = 2_147_483_647;

function readMilliseconds(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const given = env[variable];
  if (given === undefined || given === '') {
    return fallback;
  }
  const ms = Number(given);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(
      `${variable} must be a whole number of milliseconds above zero, ` +
        `not ${JSON.stringify(given)}.`,
    );
  }
  if (ms > LONGEST_TIMER_MS) {
    throw new Error(
      `${variable} may be ${LONGEST_TIMER_MS} milliseconds at most, about 24 days, ` +
        `not ${given}.`,
    );
  }
  return ms;
}
