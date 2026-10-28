/**
 * Which archive of a Plugin Release `install` takes: the one for this
 * platform and arch first, the one for every platform second, and none
 * is a broken Plugin Release (ADR-0033).
 *
 * The archives differ in one file each, so a test reads which was taken from
 * what landed. GitHub is the fake in `helpers/github.ts`.
 */
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

const HERE = `${process.platform}-${process.arch}`;
/** A platform no test machine is. */
const ELSEWHERE = 'plan9-mips';

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

test('with both archives, install takes the one for this platform and arch', async (t) => {
  const github = await serveGitHub(t);
  const everywhere = await pluginRelease(t, fixture('marker'), 'both', '1.0.0');
  const here = await pluginRelease(t, fixture('both'), 'both', '1.0.0', HERE);
  const elsewhere = await pluginRelease(t, fixture('marker'), 'both', '1.0.0', ELSEWHERE);
  github.publish('someone/both', {
    tag: 'v1.0.0',
    assets: { ...everywhere.assets, ...elsewhere.assets, ...here.assets },
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'both');
  assert.ok(await exists(join(landed, 'private.txt')), 'the files of the archive for this machine');
  assert.ok(github.asked.some((path) => path.endsWith(`/both-1.0.0-${HERE}.tar.gz`)));
  assert.ok(!github.asked.some((path) => path.endsWith('/both-1.0.0.tar.gz')));
});

test('with only the archive for every platform, install takes it', async (t) => {
  const github = await serveGitHub(t);
  const everywhere = await pluginRelease(t, fixture('both'), 'both', '1.0.0');
  const elsewhere = await pluginRelease(t, fixture('marker'), 'both', '1.0.0', ELSEWHERE);
  github.publish('someone/both', {
    tag: 'v1.0.0',
    assets: { ...everywhere.assets, ...elsewhere.assets },
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(await exists(join(home, 'shelf', 'both', 'private.txt')));
});

test('with only archives for other platforms, install refuses, naming this one, and does not clone', async (t) => {
  const github = await serveGitHub(t);
  github.publish(
    'someone/both',
    await pluginRelease(t, fixture('both'), 'both', '1.0.0', ELSEWHERE),
  );
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.notEqual(installed.code, 0);
  assert.ok(installed.stderr.includes(HERE), installed.stderr);
  assert.equal(installed.stderr.trim().split('\n').length, 1, 'one sentence');
  assert.deepEqual(await readdir(join(home, 'shelf')).catch(() => []), [], 'nothing landed');
});

test('the archive script makes an archive for one platform and arch, with its .sha256', async (t) => {
  const release = await pluginRelease(t, fixture('both'), 'both', '1.0.0', 'linux-arm64');

  assert.deepEqual(Object.keys(release.assets).sort(), [
    'both-1.0.0-linux-arm64.tar.gz',
    'both-1.0.0-linux-arm64.tar.gz.sha256',
  ]);
});
