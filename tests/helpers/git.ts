/**
 * git for the tests that clone: bare repositories made in a test's own
 * temporary directory, and the environment that sends the Official Plugins'
 * GitHub URLs to them.
 *
 * No test reaches the network. git rewrites a URL for any program that runs
 * it when its configuration says so, and that configuration is set here
 * through the environment, so FirstMate needs no switch of its own for tests.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fixture, makeHome } from './host.ts';

/** Where every Official Plugin lives, and so the prefix a test rewrites. */
const OFFICIAL_PREFIX = 'https://github.com/luanAfons0/';

/** Every Official Plugin name, as `firstmate --help` lists them. */
const OFFICIAL_NAMES = ['worklog', 'scheduler', 'nexus'];

/** The machine's own git configuration, kept out of every run. */
const NO_CONFIGURATION = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

/** One run of git, with the machine's own configuration kept out of it. */
function git(cwd: string, argv: readonly string[]): Promise<number | null> {
  return new Promise((done, fail) => {
    const child = spawn('git', argv, {
      cwd,
      env: { ...process.env, ...NO_CONFIGURATION },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.once('error', fail);
    child.once('exit', done);
  });
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
  assert.equal(
    await git(work, [
      '-c',
      'user.email=nobody@example.invalid',
      '-c',
      'user.name=A Test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'the Plugin',
    ]),
    0,
  );

  const bare = join(into, named);
  assert.equal(await git(into, ['clone', '--quiet', '--bare', work, bare]), 0);
  return bare;
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
    ...NO_CONFIGURATION,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${scratch}/.insteadOf`,
    GIT_CONFIG_VALUE_0: OFFICIAL_PREFIX,
  };
}
