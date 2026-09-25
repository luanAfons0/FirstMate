/** Adding and removing a Plugin, without hand-editing a file. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

async function registry(home: string): Promise<{
  plugins: { name: string; directory: string; grants: string[] }[];
}> {
  return JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as {
    plugins: { name: string; directory: string; grants: string[] }[];
  };
}

test('a Plugin is added by name and directory, and the Host then serves it', async (t) => {
  const home = await makeHome(t);

  const added = await firstmate(home, ['add', 'both', fixture('both')]);
  assert.equal(added.code, 0, added.stderr);
  assert.match(added.stdout, /added both/);
  assert.match(added.stdout, /restart the Host/);

  const written = await registry(home);
  assert.deepEqual(written.plugins, [{ name: 'both', directory: fixture('both'), grants: [] }]);

  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('href="/p/both/"'), 'the Host serves what was added');
});

test('adding neither copies nor symlinks the directory', async (t) => {
  const home = await makeHome(t);

  await firstmate(home, ['add', 'both', fixture('both')]);

  const written = await registry(home);
  assert.equal(written.plugins[0]?.directory, fixture('both'), 'the path is kept as given');
  const inside = await readFile(join(home, 'registry.json'), 'utf8');
  assert.ok(!inside.includes('..'), 'nothing was resolved somewhere else');
  await assert.rejects(readFile(join(home, 'both', 'mcp')), 'no copy was made');
});

test('a Plugin is removed by name, and its directory is left alone', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);

  const removed = await firstmate(home, ['remove', 'both']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.match(removed.stdout, /The directory is untouched/);

  const written = await registry(home);
  assert.deepEqual(
    written.plugins.map((row) => row.name),
    ['page-only'],
  );
  await readFile(join(fixture('both'), 'mcp'), 'utf8');

  const host = await bootHostIn(t, home);
  const gone = await host.fetch('/p/both/');
  assert.equal(gone.status, 404, 'the Host serves it no longer');
});

test('the Registry is listed, and an empty one says nothing', async (t) => {
  const home = await makeHome(t);

  const empty = await firstmate(home, ['list']);
  assert.equal(empty.code, 0);
  assert.equal(empty.stdout, '');

  await firstmate(home, ['add', 'both', fixture('both')]);
  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 0);
  assert.equal(listed.stdout, `both\t${fixture('both')}\n`);
});

test('a duplicate Plugin Name is refused', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const again = await firstmate(home, ['add', 'both', fixture('page-only')]);

  assert.equal(again.code, 1);
  assert.match(again.stderr, /already registered/);
  assert.deepEqual((await registry(home)).plugins.length, 1, 'the first row is untouched');
});

test('a path that is not a directory is refused', async (t) => {
  const home = await makeHome(t);

  const file = await firstmate(home, ['add', 'thing', join(fixture('both'), 'mcp')]);
  assert.equal(file.code, 1);
  assert.match(file.stderr, /is not a directory/);

  const missing = await firstmate(home, ['add', 'thing', '/no/such/place']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /is not a directory/);

  const relative = await firstmate(home, ['add', 'thing', 'tests/fixtures/both']);
  assert.equal(relative.code, 1);
  assert.match(relative.stderr, /is not an absolute path/);
});

test('a name that is not a Plugin Name is refused', async (t) => {
  const home = await makeHome(t);

  for (const name of ['Both', 'both/../elsewhere', 'with space', '-leading', '']) {
    const answer = await firstmate(home, ['add', name, fixture('both')]);
    assert.notEqual(answer.code, 0, name);
  }
});

test('removing a Plugin that is not registered is refused', async (t) => {
  const home = await makeHome(t);

  const answer = await firstmate(home, ['remove', 'nobody']);

  assert.equal(answer.code, 1);
  assert.match(answer.stderr, /no Plugin named nobody/);
});

test('a Grant is recorded for one pair, in one direction', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);

  const granted = await firstmate(home, ['grant', 'both', 'page-only']);
  assert.equal(granted.code, 0, granted.stderr);
  assert.match(granted.stdout, /restart the Host/);

  const written = await registry(home);
  assert.deepEqual(written.plugins[0]?.grants, ['page-only'], 'both may call page-only');
  assert.deepEqual(written.plugins[1]?.grants, [], 'the Grant does not run the other way');

  const listed = await firstmate(home, ['list']);
  assert.match(listed.stdout, /grants: page-only/);
});

test('granting the same pair twice leaves one Grant, not two', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['grant', 'both', 'page-only']);

  const again = await firstmate(home, ['grant', 'both', 'page-only']);
  assert.equal(again.code, 0, again.stderr);

  const written = await registry(home);
  assert.deepEqual(written.plugins[0]?.grants, ['page-only']);
});

test('a Grant is taken back, and the Registry says so', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['grant', 'both', 'page-only']);

  const revoked = await firstmate(home, ['revoke', 'both', 'page-only']);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.match(revoked.stdout, /restart the Host/);

  const written = await registry(home);
  assert.deepEqual(written.plugins[0]?.grants, []);
});

test('taking back a Grant that was never given says so, and changes nothing', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);

  const revoked = await firstmate(home, ['revoke', 'both', 'page-only']);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.match(revoked.stdout, /never granted/);

  const written = await registry(home);
  assert.deepEqual(written.plugins[0]?.grants, []);
});

test('a Grant refuses a Plugin Name that is not registered', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const grantMissingTo = await firstmate(home, ['grant', 'both', 'nobody']);
  assert.equal(grantMissingTo.code, 1);
  assert.match(grantMissingTo.stderr, /no Plugin named nobody/);

  const grantMissingFrom = await firstmate(home, ['grant', 'nobody', 'both']);
  assert.equal(grantMissingFrom.code, 1);
  assert.match(grantMissingFrom.stderr, /no Plugin named nobody/);

  const revokeMissing = await firstmate(home, ['revoke', 'both', 'nobody']);
  assert.equal(revokeMissing.code, 1);
  assert.match(revokeMissing.stderr, /no Plugin named nobody/);

  assert.deepEqual((await registry(home)).plugins[0]?.grants, [], 'nothing was written');
});

test('a Grant refuses a malformed Plugin Name', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const granted = await firstmate(home, ['grant', 'both', 'With Space']);
  assert.equal(granted.code, 1);
  assert.match(granted.stderr, /is not a Plugin Name/);

  const revoked = await firstmate(home, ['revoke', 'With Space', 'both']);
  assert.equal(revoked.code, 1);
  assert.match(revoked.stderr, /is not a Plugin Name/);
});

test('every other Plugin, and its Grants, survive a grant and a revoke', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['add', 'server-only', fixture('server-only')]);
  await firstmate(home, ['grant', 'page-only', 'server-only']);

  await firstmate(home, ['grant', 'both', 'page-only']);
  await firstmate(home, ['revoke', 'both', 'page-only']);

  const written = await registry(home);
  assert.deepEqual(
    written.plugins.map((row) => [row.name, row.directory]),
    [
      ['both', fixture('both')],
      ['page-only', fixture('page-only')],
      ['server-only', fixture('server-only')],
    ],
    'every row survives untouched',
  );
  assert.deepEqual(written.plugins[1]?.grants, ['server-only'], "page-only's own Grant survives");
});

test('the Registry keeps room for Grants, which v1 never enforces', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);

  // A Grant written by hand today is a Grant the Host will read tomorrow.
  const written = await registry(home);
  const [both] = written.plugins;
  assert.ok(both, 'the Registry holds a row for "both"');
  both.grants = ['page-only'];
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(join(home, 'registry.json'), JSON.stringify(written, null, 2)),
  );

  const removed = await firstmate(home, ['remove', 'page-only']);
  assert.equal(removed.code, 0, removed.stderr);

  const after = await registry(home);
  assert.deepEqual(after.plugins[0]?.grants, ['page-only'], 'a Grant survives a rewrite');

  const host = await bootHostIn(t, home);
  assert.equal((await host.fetch('/')).status, 200, 'and the Host still reads the Registry');
});
