/**
 * Installing a Plugin from a git URL.
 *
 * It needs no network: every clone here comes from a bare repository made
 * inside the test's own temporary directory, over `file://`. It skips itself
 * where git is absent, the way the suite already skips a test whose directory
 * is not there.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

/** One run of git, with the machine's own configuration kept out of it. */
function git(cwd: string, argv: readonly string[]): Promise<number | null> {
  return new Promise((done, fail) => {
    const child = spawn('git', argv, {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.once('error', fail);
    child.once('exit', done);
  });
}

async function hasGit(): Promise<boolean> {
  return new Promise((done) => {
    const probe = spawn('git', ['--version'], { stdio: 'ignore' });
    probe.once('error', () => done(false));
    probe.once('exit', (code) => done(code === 0));
  });
}

/** A bare repository holding a fixture Plugin, made in this test's own home. */
async function bareRepositoryOf(t: TestContext, plugin: string, named: string): Promise<string> {
  const scratch = await makeHome(t);
  const work = join(scratch, 'work');
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

  const bare = join(scratch, `${named}.git`);
  assert.equal(await git(scratch, ['clone', '--quiet', '--bare', work, bare]), 0);
  return bare;
}

test('a git URL is cloned into the Shelf, registered, and then served', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', `file://${bare}`]);

  assert.equal(installed.code, 0, installed.stderr);
  // The name is the last segment of the URL, without its git suffix.
  const landed = join(home, 'shelf', 'both');
  assert.ok(installed.stdout.includes(`installed both at ${landed}`), installed.stdout);
  assert.match(installed.stdout, /restart the Host/);

  assert.ok((await stat(join(landed, 'mcp'))).mode & 0o111, 'mcp is still executable');
  await readFile(join(landed, 'web', 'index.html'));

  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('href="/p/both/"'), 'the Host serves what was cloned');
  assert.ok(page.includes('1 Running'), 'and runs the Plugin Server out of the clone');
});

test('a clone that fails says so, and leaves the Registry and the Shelf alone', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const home = await makeHome(t);

  const failed = await firstmate(home, ['install', 'file:///no/such/repository.git']);

  assert.equal(failed.code, 1, failed.stdout);
  assert.match(failed.stderr, /git could not clone/, 'git is named, and so is the URL');
  await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
  assert.deepEqual(await readdir(join(home, 'shelf')), [], 'nothing half fetched was left');
});

test('the refusals of the directory case hold for a URL too', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const bare = await bareRepositoryOf(t, 'page-only', 'page-only');
  const url = `file://${bare}`;
  const home = await makeHome(t);

  const first = await firstmate(home, ['install', url]);
  assert.equal(first.code, 0, first.stderr);

  // A name already in the Registry, and a directory already in the Shelf.
  const again = await firstmate(home, ['install', url]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already registered/);

  await firstmate(home, ['remove', 'page-only']);
  const overTheFiles = await firstmate(home, ['install', url]);
  assert.equal(overTheFiles.code, 1);
  assert.match(overTheFiles.stderr, /already exists/);

  // And a name that is not a Plugin Name, in the words add uses.
  const badName = await firstmate(home, ['install', url, 'Page Only']);
  assert.equal(badName.code, 1);
  assert.match(badName.stderr, /is not a Plugin Name\. Use lower-case letters/);
});
