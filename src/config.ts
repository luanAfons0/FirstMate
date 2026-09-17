/**
 * Where the Host keeps its state and which port it listens on.
 *
 * Both come from the environment. The home directory override is what lets a
 * test boot a real Host against a temporary directory, which is the single
 * seam this project tests through.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** The environment variable that moves the Host's home directory. */
export const HOME_VARIABLE = 'FIRSTMATE_HOME';

/** The environment variable that moves the Host's port. */
export const PORT_VARIABLE = 'FIRSTMATE_PORT';

/** The fixed port, so that the address is predictable and can be bookmarked. */
export const DEFAULT_PORT = 4747;

/** The one address the Host answers on. Nothing else on the network reaches it. */
export const BIND_ADDRESS = '127.0.0.1';

export type Config = {
  /** The absolute path of the Host's home directory. */
  readonly home: string;
  /** The port to listen on. Zero asks the system for a free one. */
  readonly port: number;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return { home: readHome(env), port: readPort(env) };
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
