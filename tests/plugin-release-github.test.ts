/**
 * How `install` and `update` read what GitHub says about a repository's
 * Plugin Releases: its secondary rate limit, and a Release that holds no
 * archive at all (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`, and clones
 * come from bare repositories made in the test's own directory over `file://`.
 */
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import { bareRepositoryOf, hasGit } from './helpers/git.ts';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

type Registry = {
  plugins: { name: string; release?: { repository: string; version: string } }[];
};

async function registry(home: string): Promise<Registry> {
  return JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as Registry;
}

/** A Plugin Release of the `both` fixture at this Release Version, whose `private.txt` says so. */
async function releaseOf(t: TestContext, version: string) {
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await writeFile(join(folder, 'private.txt'), `${version}\n`);
  return pluginRelease(t, folder, 'both', version);
}

/** The releases path the command line asks first. */
const LIST = '/repos/someone/both/releases?per_page=100';

test('a 403 with retry-after, the secondary rate limit, is refused with that time', async (t) => {
  const github = await serveGitHub(t);
  github.answer(LIST, {
    status: 403,
    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4999' },
    body: '{"message":"You have exceeded a secondary rate limit."}',
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(installed.stderr, /Try again in 1 minute\./);
  assert.deepEqual(github.asked, [LIST], 'no clone');
});

test('a repository whose Releases hold no archive at all is cloned, with the line', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const github = await serveGitHub(t);
  github.publish('someone/both', { tag: 'v1.0.0', assets: {} });
  github.publish('someone/both', {
    tag: 'v1.1.0',
    assets: { 'notes.txt': Buffer.from('what changed\n') },
  });
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'https://github.com/someone/both'], {
    ...github.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${bare}.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/someone/both',
  });

  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(
    installed.stdout.includes('both has no Plugin Release; cloned it instead.'),
    installed.stdout,
  );
  assert.equal('release' in ((await registry(home)).plugins[0] ?? {}), false);
});

test('a newer Release with no archive at all is passed over for the Plugin Release', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await releaseOf(t, '1.0.0'));
  github.publish('someone/both', {
    tag: 'v1.1.0',
    assets: { 'notes.txt': Buffer.from('what changed\n') },
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 0, installed.stderr);
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.0.0');
});
