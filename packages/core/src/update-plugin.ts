/**
 * Moving a Plugin that is a git clone forward to its upstream, and nothing
 * else (ADR-0030).
 *
 * A Plugin has no manifest, so its version is its commit, and an update is a
 * fetch and a fast-forward. Nothing is merged, nothing is copied over, and the
 * files git ignores, where a Plugin keeps its data, are never touched
 * (ADR-0005). Every step that would lose something refuses instead, before
 * the step that changes anything, so a refusal leaves the clone as it was.
 *
 * The steps run git through a runner: one git command, in the Plugin's own
 * directory, wherever the git that owns that clone is. A `local` Place's
 * runner is this machine's git. A `wsl` Place runs git inside its
 * distribution, and that runner is the one thing such a Place adds: the
 * steps, their order and their sentences are the same in every Place.
 *
 * Every command runs with repository hooks and fsmonitor off, so an update
 * runs nothing a clone can configure for itself, as a fetch runs nothing the
 * Plugin ships. git runs in the C locale, so that its words can be read here.
 */
import { spawn } from 'node:child_process';
import { askingNothing } from './fetch-plugin.ts';
import { refuse } from './refusal.ts';

/** What one git command said, and how it ended. */
type GitAnswer = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Run one git command in one Plugin's directory, and give back its answer. It
 * fails, with a sentence that says where git is missing, only when git cannot
 * be run at all; a command git runs and refuses is an answer.
 */
export type GitRunner = (argv: readonly string[]) => Promise<GitAnswer>;

/** What an update moved: the commit before it and the commit after it, short. */
export type Moved = { readonly from: string; readonly to: string };

/**
 * The settings that keep a clone from making git run anything: no hook, and
 * no file-system monitor. Given on the command line, they beat the clone's own
 * configuration.
 */
const RUNS_NOTHING = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

/** The variables that would point git at another repository than the Plugin's own. */
const ELSEWHERE = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

/**
 * The runner of a `local` Place: this machine's git, in this directory, in
 * the environment `install` clones in, so it never asks on the terminal.
 */
export function gitHere(directory: string): GitRunner {
  const env: NodeJS.ProcessEnv = { ...askingNothing(process.env), LC_ALL: 'C' };
  for (const name of ELSEWHERE) delete env[name];
  return (argv) =>
    new Promise((done, fail) => {
      const git = spawn('git', argv, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      git.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      git.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      git.once('error', (cause: NodeJS.ErrnoException) => {
        fail(
          cause.code === 'ENOENT'
            ? new Error('git is not on the PATH, and update needs it. Install git.')
            : new Error(`git could not be run: ${cause.message}`, { cause }),
        );
      });
      git.once('close', (code) =>
        done({
          code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        }),
      );
    });
}

/**
 * Move this Plugin's clone forward to its upstream, and say from which commit
 * to which, or give back nothing when the clone already holds its upstream:
 * current, or ahead with commits of the operator's own. `directory` is the
 * Plugin's directory as the operator knows it, for the sentences.
 */
export async function moveForward(
  git: GitRunner,
  name: string,
  directory: string,
): Promise<Moved | undefined> {
  const run = (...argv: string[]): Promise<GitAnswer> => git([...RUNS_NOTHING, ...argv]);

  const top = await run('rev-parse', '--is-inside-work-tree', '--show-prefix');
  if (top.code !== 0 && !/not a git repository/.test(top.stderr)) throw failed(top, directory);
  const [inside, prefix = ''] = top.stdout.split(/\r?\n/);
  if (top.code !== 0 || inside !== 'true') {
    throw refuse(
      'invalid',
      `${name} at ${directory} is not a git clone of its own, so update cannot move it: ` +
        `to update a copied Plugin, move its data out, then firstmate remove ${name} ` +
        'and install it again.',
    );
  }
  if (prefix !== '') {
    throw refuse(
      'invalid',
      `${directory} is inside a larger git repository and is not its top, ` +
        'so update will not move that repository.',
    );
  }

  const branch = await run('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch.code !== 0) {
    throw refuse(
      'invalid',
      `${name} is on no branch, at a detached HEAD, so update does not know what to follow.`,
    );
  }
  const upstream = await run('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  if (upstream.code !== 0) {
    throw refuse(
      'invalid',
      `${name}'s branch ${branch.stdout.trim()} has no upstream, ` +
        'so update does not know what to follow.',
    );
  }

  const changes = await answered(run('status', '--porcelain', '--untracked-files=no'), directory);
  if (changes.stdout.trim() !== '') {
    throw refuse(
      'invalid',
      `${name} has local changes to tracked files, which update would not keep: ` +
        'commit them or undo them first.',
    );
  }

  const fetched = await run('fetch', '--quiet');
  if (fetched.code !== 0) {
    throw new Error(`git could not fetch ${name}'s upstream: ${reasonOf(fetched)}.`);
  }

  if (await holds(run, '@{upstream}', 'HEAD', directory)) return undefined;
  if (!(await holds(run, 'HEAD', '@{upstream}', directory))) {
    throw refuse(
      'invalid',
      `${name} has commits its upstream does not have, and its upstream has moved on too, ` +
        'so it cannot move forward without a merge.',
    );
  }

  const from = await shortHead(run, directory);
  const merged = await run('merge', '--ff-only', '--quiet', '@{upstream}');
  if (merged.code !== 0) {
    if (/untracked working tree files would be overwritten/.test(merged.stderr)) {
      const files = merged.stderr
        .split(/\r?\n/)
        .filter((line) => line.startsWith('\t'))
        .map((line) => line.trim());
      throw refuse(
        'invalid',
        `the update of ${name} would overwrite untracked files, ${files.join(', ')}: ` +
          'move them away first.',
      );
    }
    throw failed(merged, directory);
  }
  return { from, to: await shortHead(run, directory) };
}

/** Whether the commit `inner` names is already in the history of `outer`. */
async function holds(
  run: (...argv: string[]) => Promise<GitAnswer>,
  inner: string,
  outer: string,
  directory: string,
): Promise<boolean> {
  const asked = await run('merge-base', '--is-ancestor', inner, outer);
  if (asked.code === 0 || asked.code === 1) return asked.code === 0;
  throw failed(asked, directory);
}

/** The commit HEAD is at, short. */
async function shortHead(
  run: (...argv: string[]) => Promise<GitAnswer>,
  directory: string,
): Promise<string> {
  return (await answered(run('rev-parse', '--short', 'HEAD'), directory)).stdout.trim();
}

/** An answer that must be a success, or the failure that says it was not. */
async function answered(asked: Promise<GitAnswer>, directory: string): Promise<GitAnswer> {
  const answer = await asked;
  if (answer.code !== 0) throw failed(answer, directory);
  return answer;
}

/** A git command that failed where nothing was expected to, in git's own words. */
function failed(answer: GitAnswer, directory: string): Error {
  return new Error(`git failed in ${directory}: ${reasonOf(answer)}.`);
}

/** What git said when it failed, in one line with no full stop of its own. */
function reasonOf(answer: GitAnswer): string {
  const said = (answer.stderr || answer.stdout).split(/\r?\n/).find((line) => line.trim() !== '');
  return said === undefined ? `it exited ${answer.code}` : said.trim().replace(/\.$/, '');
}
