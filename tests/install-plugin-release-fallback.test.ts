/**
 * What `install` does when it cannot take the newest Plugin Release: it
 * clones where nothing was published, and it refuses where GitHub is limiting
 * it or where the release cannot be checked (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`, and clones
 * come from bare repositories made in the test's own directory over `file://`.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import { bareRepositoryOf, hasGit } from './helpers/git.ts';
import { canStart, firstmate, fixture, makeHome } from './helpers/host.ts';

/** The Registry and the Shelf are as they were: no row, and no file left behind. */
async function assertUntouched(home: string): Promise<void> {
  await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
  assert.deepEqual(await readdir(join(home, 'shelf')).catch(() => []), [], 'the Shelf is empty');
}

/** Run an install where git is needed, or skip the test where git is absent. */
async function needsGit(t: TestContext): Promise<boolean> {
  if (await hasGit()) return true;
  t.skip('this machine has no git to clone with');
  return false;
}

test('a repository with no Plugin Release is cloned, with a line that says so', async (t) => {
  if (!(await needsGit(t))) return;
  const github = await serveGitHub(t);
  github.publish('someone/both');
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);

  // The clone of the GitHub URL is sent to the local bare repository.
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
  assert.deepEqual(github.asked, ['/repos/someone/both/releases?per_page=100']);
  const landed = join(home, 'shelf', 'both');
  assert.ok(await canStart(landed), 'mcp is still executable');
  const registry = JSON.parse(await readFile(join(home, 'registry.json'), 'utf8'));
  assert.equal('release' in registry.plugins[0], false, 'a clone has no release');
});

test('a non-GitHub URL is cloned, with the line, and GitHub is not asked', async (t) => {
  if (!(await needsGit(t))) return;
  const github = await serveGitHub(t);
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', `file://${bare}`], github.env);

  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(installed.stdout.includes('both has no Plugin Release; cloned it instead.'));
  assert.deepEqual(github.asked, []);
});

test('an Official Plugin that GitHub does not show is cloned, with the line', async (t) => {
  if (!(await needsGit(t))) return;
  // The fake knows no repository, so it answers 404 for the Official Plugin's
  // URL, as GitHub does for a private repository. The clone then fails here,
  // because its URL is the real one, and says so without a Registry row.
  const github = await serveGitHub(t);
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'worklog'], {
    ...github.env,
    GIT_ALLOW_PROTOCOL: 'none',
  });

  assert.deepEqual(github.asked, ['/repos/luanAfons0/worklog/releases?per_page=100']);
  assert.equal(installed.code, 1, installed.stdout);
  assert.match(installed.stderr, /git could not clone/);
  await assertUntouched(home);
});

test('a GitHub URL that answers 404 is tried as a clone, not refused', async (t) => {
  if (!(await needsGit(t))) return;
  const github = await serveGitHub(t);
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'https://github.com/someone/private'], {
    ...github.env,
    GIT_ALLOW_PROTOCOL: 'none',
  });

  assert.deepEqual(github.asked, ['/repos/someone/private/releases?per_page=100']);
  assert.match(installed.stderr, /git could not clone/, 'the clone was tried');
  await assertUntouched(home);
});

test('the rate limit is refused with the time to try again, and nothing is cloned', async (t) => {
  const github = await serveGitHub(t);
  const reset = Math.floor(Date.now() / 1000) + 600;
  github.answer('/repos/someone/both/releases?per_page=100', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    body: '{"message":"API rate limit exceeded"}',
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(installed.stderr, /Try again in (9|10) minutes\./);
  assert.deepEqual(github.asked, ['/repos/someone/both/releases?per_page=100'], 'no clone');
  await assertUntouched(home);
});

test('a 429 with retry-after is refused with that time', async (t) => {
  const github = await serveGitHub(t);
  github.answer('/repos/someone/both/releases?per_page=100', {
    status: 429,
    headers: { 'retry-after': '120' },
  });
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'git@github.com:someone/both'], github.env);

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(installed.stderr, /Try again in 2 minutes\./);
  await assertUntouched(home);
});

test('a Plugin Release with no .sha256 is refused, not cloned', async (t) => {
  const github = await serveGitHub(t);
  const release = await pluginRelease(t, fixture('both'), 'both', '1.2.0');
  const { 'both-1.2.0.tar.gz.sha256': _removed, ...assets } = release.assets;
  github.publish('someone/both', { ...release, assets });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 4, installed.stdout);
  assert.match(installed.stderr, /holds no .*both-1\.2\.0\.tar\.gz\.sha256/);
  assert.equal(
    github.asked.some((path) => path.endsWith('.git')),
    false,
  );
  await assertUntouched(home);
});

test('a Plugin Release whose .sha256 is wrong is refused, not cloned', async (t) => {
  const github = await serveGitHub(t);
  const release = await pluginRelease(t, fixture('both'), 'both', '1.2.0');
  github.publish('someone/both', {
    ...release,
    assets: {
      ...release.assets,
      'both-1.2.0.tar.gz.sha256': Buffer.from(`${'0'.repeat(64)}  both-1.2.0.tar.gz\n`),
    },
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(installed.stderr, /does not match its published SHA-256/);
  await assertUntouched(home);
});
