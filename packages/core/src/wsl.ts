/**
 * `wsl.exe`, as the command line asks it things about a `wsl` Place.
 *
 * It is the one external tool a `wsl` Place needs, as `git` is the one a URL
 * needs: not a package dependency, and it runs nothing a Plugin ships. A test
 * puts a fake `wsl.exe` first on PATH, as the systemd tests fake `systemctl`.
 *
 * `wsl.exe` writes its own messages as UTF-16, and the program it runs writes
 * whatever that program writes. Both are read here as the text they are.
 */
import { spawn } from 'node:child_process';
import { refuse } from './refusal.ts';

/** The program that runs a command inside a WSL distribution. */
export const WSL_EXE = 'wsl.exe';

/** What one run of `wsl.exe` said. */
type Answer = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

/** Run `wsl.exe` with these words, and wait for its answer. */
function ask(argv: readonly string[]): Promise<Answer> {
  return new Promise((done, fail) => {
    const child = spawn(WSL_EXE, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', (cause: NodeJS.ErrnoException) => {
      fail(
        cause.code === 'ENOENT'
          ? refuse('invalid', `${WSL_EXE} is not on the PATH, and a wsl Place needs it.`)
          : new Error(`${WSL_EXE} could not be run: ${cause.message}`, { cause }),
      );
    });
    child.once('close', (code) =>
      done({ code, stdout: text(Buffer.concat(out)), stderr: text(Buffer.concat(err)) }),
    );
  });
}

/**
 * Bytes as text. `wsl.exe` writes its own messages as UTF-16, which shows as a
 * zero byte after every letter of plain text.
 */
function text(bytes: Buffer): string {
  const wide = bytes.length >= 2 && bytes[1] === 0;
  return (wide ? bytes.toString('utf16le') : bytes.toString('utf8')).replace(/^\uFEFF/, '').trim();
}

/** What `wsl.exe` said when it failed, in one line. */
function why(answer: Answer): string {
  const said = (answer.stderr || answer.stdout).split(/\r?\n/).find((line) => line.trim() !== '');
  // A sentence of its own loses its full stop, so that it ends one of ours.
  return said === undefined ? `it exited ${answer.code}` : said.trim().replace(/\.$/, '');
}

/**
 * The home directory of the user a distribution runs commands as. A refusal
 * says the distribution did not answer, in `wsl.exe`'s own words.
 */
export async function homeIn(distribution: string): Promise<string> {
  const answer = await ask(['-d', distribution, '--exec', 'sh', '-c', 'printf %s "$HOME"']);
  if (answer.code !== 0 || !answer.stdout.startsWith('/')) {
    throw refuse('invalid', `the distribution ${distribution} did not answer: ${why(answer)}.`);
  }
  return answer.stdout;
}

/**
 * Give a fetched Plugin's `mcp` file back its executable bit, inside the
 * distribution. A file written from Windows into a distribution carries none,
 * and a Plugin Server that cannot be executed leaves its Plugin Stopped. This
 * runs nothing the Plugin ships.
 */
export async function makeExecutable(distribution: string, directory: string): Promise<void> {
  const answer = await ask(['-d', distribution, '--cd', directory, '--exec', 'chmod', '+x', 'mcp']);
  if (answer.code !== 0) {
    throw new Error(`${directory}/mcp could not be made executable: ${why(answer)}.`);
  }
}

/** The systemd user unit a 1.x Host ran as. */
const ONE_X_UNIT = 'firstmate';

/**
 * Whether the 1.x Host is a systemd service in this distribution, enabled or
 * running. A distribution with no systemd has no such service.
 */
export async function oneXServiceIn(distribution: string): Promise<boolean> {
  const asked = (what: string): Promise<Answer> =>
    ask(['-d', distribution, '--exec', 'systemctl', '--user', what, '--quiet', ONE_X_UNIT]);
  return (await asked('is-enabled')).code === 0 || (await asked('is-active')).code === 0;
}

/**
 * Stop the 1.x Host's service in this distribution and keep it from starting
 * again, so that it no longer holds the port the App listens on.
 */
export async function stopOneXService(distribution: string): Promise<void> {
  const answer = await ask([
    '-d',
    distribution,
    '--exec',
    'systemctl',
    '--user',
    'disable',
    '--now',
    ONE_X_UNIT,
  ]);
  if (answer.code !== 0) {
    throw new Error(`the 1.x service in ${distribution} did not stop: ${why(answer)}.`);
  }
}
