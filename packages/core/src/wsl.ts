/**
 * `wsl.exe`, as the command line asks it things about a `wsl` Place.
 *
 * It is the one external tool a `wsl` Place needs, as `git` is the one a URL
 * needs: not a package dependency, and it runs nothing a Plugin ships. A test
 * puts a fake `wsl.exe` first on PATH.
 *
 * `wsl.exe` writes its own messages as UTF-16, and the program it runs writes
 * whatever that program writes. Both are read here as the text they are.
 */
import { spawn } from 'node:child_process';
import { refuse } from './refusal.ts';
import { gitEnvironmentWords, type GitRunner } from './git.ts';

/** The program that runs a command inside a WSL distribution. */
export const WSL_EXE = 'wsl.exe';

/**
 * Whether this process runs inside WSL, as WSL itself says: it names the
 * distribution in WSL_DISTRO_NAME for every process it starts.
 */
export function isInsideWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['WSL_DISTRO_NAME'] ?? '') !== '';
}

/** What one run of `wsl.exe` said. */
type Answer = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** It did not answer in the time it was given, and was ended. */
  readonly late: boolean;
};

/**
 * Run `wsl.exe` with these words, and wait for its answer: for as long as it
 * takes, or until `waitMs`, when it is ended.
 */
function ask(argv: readonly string[], waitMs?: number): Promise<Answer> {
  return new Promise((done, fail) => {
    const child = spawn(WSL_EXE, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let late = false;
    const timer =
      waitMs === undefined
        ? undefined
        : setTimeout(() => {
            late = true;
            child.kill();
          }, waitMs);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', (cause: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(
        cause.code === 'ENOENT'
          ? refuse('invalid', `${WSL_EXE} is not on the PATH, and a wsl Place needs it.`)
          : new Error(`${WSL_EXE} could not be run: ${cause.message}`, { cause }),
      );
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout: text(Buffer.concat(out)), stderr: text(Buffer.concat(err)), late });
    });
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
 * What a shell script printed inside a distribution. It fails with a sentence
 * when the distribution does not answer, or not within `waitMs`, which ends
 * the call: a reader that asks again must never find the last one still
 * waiting.
 */
export async function printedInside(
  distribution: string,
  script: string,
  waitMs: number,
): Promise<string> {
  const answer = await ask(['-d', distribution, '--exec', 'sh', '-c', script], waitMs);
  if (answer.late) {
    throw new Error(`the distribution ${distribution} did not answer within ${waitMs / 1000} s.`);
  }
  if (answer.code !== 0) {
    throw new Error(`the distribution ${distribution} did not answer: ${why(answer)}.`);
  }
  return answer.stdout;
}

/** Where a program is inside a distribution, or the PATH it was looked for on there. */
type FoundInside = { readonly found: string } | { readonly path: string };

/** The exit code a shell, and `env`, give when the program they were asked to run is not there. */
const NOT_FOUND = 127;

/**
 * Look for a program inside a distribution, as `wsl.exe` runs it: an
 * absolute path as it is, and a name on the PATH `wsl.exe` gives a command,
 * which reads no profile and is often not the PATH of a terminal there. The
 * program is handed to the shell as an argument, never as its text.
 */
export async function findInside(distribution: string, program: string): Promise<FoundInside> {
  const look =
    'case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] && printf %s "$1" && exit 0 ;; ' +
    '*) command -v "$1" && exit 0 ;; esac; ' +
    `printf %s "$PATH"; exit ${NOT_FOUND}`;
  const answer = await ask(['-d', distribution, '--exec', 'sh', '-c', look, 'sh', program]);
  if (answer.code === 0 && answer.stdout.startsWith('/')) return { found: answer.stdout };
  if (answer.code === NOT_FOUND) return { path: answer.stdout };
  throw refuse('invalid', `the distribution ${distribution} did not answer: ${why(answer)}.`);
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

/**
 * The git runner of a `wsl` Place: the distribution's own git, in the
 * Plugin's directory as the distribution names it, as its Plugin Server runs
 * there. It fails, with a sentence, when the distribution has no git.
 */
export function gitInside(distribution: string, directory: string): GitRunner {
  // The environment of the `local` runner, given on git's command line
  // through `env`: a variable set on this side reaches the distribution only
  // when WSLENV names it, so none is left to it.
  const inside = gitEnvironmentWords(process.env);
  return async (argv) => {
    const answer = await ask(['-d', distribution, '--cd', directory, '--exec', ...inside, ...argv]);
    if (answer.code === NOT_FOUND) {
      throw new Error(
        `git is not installed in ${distribution}, and update needs it. Install git there.`,
      );
    }
    return answer;
  };
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
