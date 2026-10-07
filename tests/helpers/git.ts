/**
 * git for the tests that clone: bare repositories made in a test's own
 * temporary directory, commits added to them as a Plugin's author pushes one,
 * and the environment that sends the Official Plugins' GitHub URLs to them.
 *
 * No test reaches the network. git rewrites a URL for any program that runs
 * it when its configuration says so, and that configuration is set here
 * through the environment, so FirstMate needs no switch of its own for tests.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { fixture, makeHome } from './host.ts';

/** Where every Official Plugin lives, and so the prefix a test rewrites. */
const OFFICIAL_PREFIX = 'https://github.com/luanAfons0/';

/** Every Official Plugin name, as `firstmate --help` lists them. */
const OFFICIAL_NAMES = ['worklog', 'scheduler', 'nexus'];

/** The machine's own git configuration, kept out of every run. */
export const NO_GIT_CONFIGURATION = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

/** Who the commits a test makes are by, and that none of them is signed. */
const AUTHOR = [
  '-c',
  'user.email=nobody@example.invalid',
  '-c',
  'user.name=A Test',
  '-c',
  'commit.gpgsign=false',
];

/** What one run of git said on its output, and how it ended. */
type GitRun = { readonly code: number | null; readonly stdout: string };

/** One run of git, with the machine's own configuration kept out of it. */
function gitRun(cwd: string, argv: readonly string[]): Promise<GitRun> {
  return new Promise((done, fail) => {
    const child = spawn('git', argv, {
      cwd,
      env: { ...process.env, ...NO_GIT_CONFIGURATION },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.once('error', fail);
    child.once('close', (code) => done({ code, stdout }));
  });
}

/** How one run of git ended. */
async function git(cwd: string, argv: readonly string[]): Promise<number | null> {
  return (await gitRun(cwd, argv)).code;
}

/**
 * Run git in a directory, as an operator does by hand, and give back what it
 * printed, trimmed. A run that fails fails the test.
 */
export async function gitIn(cwd: string, argv: readonly string[]): Promise<string> {
  const ran = await gitRun(cwd, [...AUTHOR, ...argv]);
  assert.equal(ran.code, 0, `git ${argv.join(' ')} in ${cwd}`);
  return ran.stdout.trim();
}

/** The commit a clone's HEAD is at, in full. */
export function headOf(clone: string): Promise<string> {
  return gitIn(clone, ['rev-parse', 'HEAD']);
}

/** Whether this machine has git. A test that clones skips itself without it. */
export async function hasGit(): Promise<boolean> {
  return new Promise((done) => {
    const probe = spawn('git', ['--version'], { stdio: 'ignore' });
    probe.once('error', () => done(false));
    probe.once('exit', (code) => done(code === 0));
  });
}

/**
 * A bare repository holding a fixture Plugin, made in a directory of this
 * test's own, at `<directory>/<named>`.
 */
export async function bareRepositoryOf(
  t: TestContext,
  plugin: string,
  named: string,
  scratch?: string,
): Promise<string> {
  const into = scratch ?? (await makeHome(t));
  const work = join(into, `.${named}.work`);
  await cp(fixture(plugin), work, { recursive: true });

  assert.equal(await git(work, ['init', '--quiet', '--initial-branch', 'main']), 0);
  assert.equal(await git(work, ['add', '--all']), 0);
  assert.equal(await git(work, [...AUTHOR, 'commit', '--quiet', '-m', 'the Plugin']), 0);

  const bare = join(into, named);
  assert.equal(await git(into, ['clone', '--quiet', '--bare', work, bare]), 0);
  return bare;
}

/**
 * Add one commit to a bare repository, as a Plugin's author pushes one. Each
 * path is written with its text, or copied from the file given as `from`, and
 * the commit goes to `main`. It gives back the commit, in full.
 */
export async function addCommitTo(
  bare: string,
  files: Readonly<Record<string, string | { readonly from: string }>>,
): Promise<string> {
  const work = `${bare}.push`;
  await rm(work, { recursive: true, force: true });
  assert.equal(await git(dirname(bare), ['clone', '--quiet', bare, work]), 0);
  for (const [path, content] of Object.entries(files)) {
    const target = join(work, path);
    await mkdir(dirname(target), { recursive: true });
    if (typeof content === 'string') await writeFile(target, content);
    else await cp(content.from, target);
  }
  await gitIn(work, ['add', '--all']);
  await gitIn(work, ['commit', '--quiet', '-m', 'a change']);
  await gitIn(work, ['push', '--quiet', 'origin', 'main']);
  const commit = await headOf(work);
  await rm(work, { recursive: true, force: true });
  return commit;
}

/**
 * The environment under which each Official Plugin named here is cloned from
 * a local bare repository holding the `both` fixture. A name left out has no
 * repository, so cloning it fails as a missing network would.
 */
export async function officialSources(
  t: TestContext,
  names: readonly string[] = OFFICIAL_NAMES,
): Promise<NodeJS.ProcessEnv> {
  const scratch = await makeHome(t);
  for (const name of names) await bareRepositoryOf(t, 'both', name, scratch);
  return {
    ...NO_GIT_CONFIGURATION,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${scratch}/.insteadOf`,
    GIT_CONFIG_VALUE_0: OFFICIAL_PREFIX,
  };
}
