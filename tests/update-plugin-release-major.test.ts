/**
 * `firstmate update <name>` never takes a new MAJOR of a Plugin Release by
 * surprise: it takes the newest Release Version in the MAJOR it has, and says
 * in one line when a newer MAJOR is ready. `firstmate update <name> --major`
 * takes the newest Plugin Release of all, and is refused for a clone and for a
 * copy, which have no MAJOR (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`.
 */
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub, type FakeGitHub } from './helpers/github.ts';
import { bareRepositoryOf, hasGit, NO_GIT_CONFIGURATION } from './helpers/git.ts';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

/** A Plugin Release of the `both` fixture at this Release Version, whose `private.txt` says so. */
async function releaseOf(t: TestContext, version: string) {
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await writeFile(join(folder, 'private.txt'), `${version}\n`);
  return pluginRelease(t, folder, 'both', version);
}

/** A home with `both` installed from its Plugin Release 1.2.0, and the Plugin's directory. */
async function installed(t: TestContext, github: FakeGitHub, version = '1.2.0') {
  github.publish('someone/both', await releaseOf(t, version));
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', 'https://github.com/someone/both'], github.env);
  assert.equal(done.code, 0, done.stderr);
  return { home, plugin: join(home, 'shelf', 'both') };
}

async function versionOf(home: string): Promise<string | undefined> {
  const file = JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as {
    plugins: { release?: { version: string } }[];
  };
  return file.plugins[0]?.release?.version;
}

const READY =
  /^firstmate: both has a new MAJOR, 2\.0\.0, ready: run firstmate update both --major to take it\.$/m;

test('update takes the newest in the same MAJOR, and says the new MAJOR is ready', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  github.publish('someone/both', await releaseOf(t, '1.3.0'));
  github.publish('someone/both', await releaseOf(t, '2.0.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: updated both from 1\.2\.0 to 1\.3\.0$/m);
  assert.match(updated.stdout, READY);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), '1.3.0\n');
  assert.equal(await versionOf(home), '1.3.0');
});

test('update changes nothing, exit 0, when only a new MAJOR is newer, and says it is ready', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github, '1.3.0');
  github.publish('someone/both', await releaseOf(t, '2.0.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, READY);
  assert.doesNotMatch(updated.stdout, /updated both/);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), '1.3.0\n');
  assert.equal(await versionOf(home), '1.3.0');
});

test('update --major takes the newest Plugin Release of all', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  github.publish('someone/both', await releaseOf(t, '1.3.0'));
  github.publish('someone/both', await releaseOf(t, '2.0.0'));

  const updated = await firstmate(home, ['update', 'both', '--major'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: updated both from 1\.2\.0 to 2\.0\.0$/m);
  assert.doesNotMatch(updated.stdout, /ready/);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), '2.0.0\n');
  assert.equal(await versionOf(home), '2.0.0');
});

test('--major may come before the Plugin Name', async (t) => {
  const github = await serveGitHub(t);
  const { home } = await installed(t, github);
  github.publish('someone/both', await releaseOf(t, '2.0.0'));

  const updated = await firstmate(home, ['update', '--major', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(await versionOf(home), '2.0.0');
});

test('update --major with nothing newer says nothing', async (t) => {
  const github = await serveGitHub(t);
  const { home } = await installed(t, github);

  const updated = await firstmate(home, ['update', 'both', '--major'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(updated.stdout, '');
});

test('update --major of a copy is refused in one sentence', async (t) => {
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', fixture('both')]);
  assert.equal(done.code, 0, done.stderr);

  const updated = await firstmate(home, ['update', 'both', '--major']);

  assert.notEqual(updated.code, 0);
  assert.match(updated.stderr, /--major/);
  assert.equal(updated.stderr.trim().split('\n').length, 1, updated.stderr);
});

test('update --major of a clone is refused in one sentence, and the clone is not fetched', async (t) => {
  if (!(await hasGit())) return t.skip('this machine has no git to clone with');
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', `file://${bare}`], NO_GIT_CONFIGURATION);
  assert.equal(done.code, 0, done.stderr);

  const updated = await firstmate(home, ['update', 'both', '--major'], NO_GIT_CONFIGURATION);

  assert.notEqual(updated.code, 0);
  assert.match(updated.stderr, /--major/);
  assert.equal(updated.stderr.trim().split('\n').length, 1, updated.stderr);
});
