/** The edges of the command line: a symlinked source, a damaged Registry, a git short form. */
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

test('a source that is a symlink to a directory is copied, not linked', async (t) => {
  const home = await makeHome(t);
  const link = join(home, 'linked');
  await symlink(fixture('both'), link);

  const installed = await firstmate(home, ['install', link]);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(await realpath(join(home, 'shelf')), 'linked');
  const found = await lstat(landed);
  assert.ok(found.isDirectory(), 'the Shelf holds a directory');
  assert.ok(!found.isSymbolicLink(), 'and not a pointer back to the source');
  await readFile(join(landed, 'web', 'index.html'));
});

test('a symlink in the Shelf that points nowhere still blocks the name', async (t) => {
  const home = await makeHome(t);
  const shelf = join(home, 'shelf');
  await mkdir(shelf);
  await symlink(join(home, 'nothing-here'), join(shelf, 'both'));

  const refused = await firstmate(home, ['install', fixture('both')]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already exists/);
  assert.equal(await readlink(join(shelf, 'both')), join(home, 'nothing-here'), 'it is untouched');
});

test('a Registry that names one Plugin twice is refused', async (t) => {
  const home = await makeHome(t);
  const row = { name: 'both', directory: fixture('both'), grants: [] };
  await writeFile(join(home, 'registry.json'), JSON.stringify({ plugins: [row, row] }));

  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 1);
  assert.match(listed.stderr, /names both twice/);
});

test('a Grant that is not a Plugin Name is refused', async (t) => {
  const home = await makeHome(t);
  const row = { name: 'both', directory: fixture('both'), grants: ['Not A Name'] };
  await writeFile(join(home, 'registry.json'), JSON.stringify({ plugins: [row] }));

  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 1);
  assert.match(listed.stderr, /needs its Grants as an array of Plugin Names/);
});

test('the short form of a git URL names its Plugin after the colon', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'tidy', fixture('both')]);

  // Refused as a name already taken, before anything is cloned, which shows
  // the name that was read from the URL.
  const refused = await firstmate(home, ['install', 'git@example.invalid:tidy.git']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /tidy is already registered/);
});

test('help works while an environment variable holds nonsense', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['--help'], { FIRSTMATE_PORT: 'not a port' });

  assert.equal(helped.code, 0, helped.stderr);
  assert.match(helped.stdout, /usage:/);
});
