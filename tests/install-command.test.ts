/** Installing a Plugin: fetched into the Shelf, and registered in one step. */
import assert from 'node:assert/strict';
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
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

/** A directory that is really there, under a home this test owns. */
async function directory(home: string, name: string): Promise<string> {
  const made = join(home, name);
  await mkdir(made);
  return realpath(made);
}

test('a directory is copied into the Shelf, registered, and then served', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');
  await firstmate(home, ['shelf', shelf]);

  const installed = await firstmate(home, ['install', fixture('both')]);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(shelf, 'both');
  assert.ok(installed.stdout.includes(`installed both at ${landed}`), installed.stdout);
  assert.match(installed.stdout, /restart the Host/);

  // The files landed, with the bit the Host needs to run the Plugin Server.
  assert.ok((await stat(join(landed, 'mcp'))).mode & 0o111, 'mcp is still executable');
  await readFile(join(landed, 'web', 'index.html'));

  assert.deepEqual(await registry(home), {
    plugins: [{ name: 'both', directory: landed, grants: [] }],
  });

  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('href="/p/both/"'), 'the Host serves what was installed');
  assert.ok(page.includes('1 Running'), 'and runs the Plugin Server out of the copy');
});

test('install works before a Shelf has been chosen', async (t) => {
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', fixture('page-only')]);

  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(installed.stdout.includes(join(home, 'shelf', 'page-only')), installed.stdout);
  await readFile(join(home, 'shelf', 'page-only', 'web', 'index.html'));
});

test('a source whose last segment is not a Plugin Name asks for a name', async (t) => {
  const home = await makeHome(t);
  const odd = join(home, 'Not A Name');
  await mkdir(odd);
  await writeFile(join(odd, 'private.txt'), 'nothing much\n');

  const refused = await firstmate(home, ['install', odd]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /does not name a Plugin\. Give the name yourself/);

  const named = await firstmate(home, ['install', odd, 'tidy']);
  assert.equal(named.code, 0, named.stderr);
  assert.ok(named.stdout.includes('installed tidy at'), named.stdout);
});

test('a name that is not a Plugin Name is refused in the words add uses', async (t) => {
  const home = await makeHome(t);

  const refused = await firstmate(home, ['install', fixture('both'), 'Both']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /Both is not a Plugin Name\. Use lower-case letters/);
});

test('a name already in the Registry is refused, and nothing is fetched', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const refused = await firstmate(home, ['install', fixture('both')]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already registered/);
  assert.deepEqual((await registry(home)).plugins.length, 1, 'the row that was there survives');
  await assert.rejects(stat(join(home, 'shelf')), 'nothing was copied anywhere');
});

test('a directory that already exists in the Shelf is refused, loudly', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'shelf');
  await mkdir(join(shelf, 'both'));
  await writeFile(join(shelf, 'both', 'mine.txt'), 'someone else put this here\n');

  const refused = await firstmate(home, ['install', fixture('both')]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already exists/);
  assert.equal(
    await readFile(join(shelf, 'both', 'mine.txt'), 'utf8'),
    'someone else put this here\n',
    'what was there is untouched',
  );
  await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
});

test('a fetch that fails leaves the Registry untouched and the Shelf clean', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads anything, so nothing here can fail');
    return;
  }
  const home = await makeHome(t);
  const shelf = await directory(home, 'shelf');
  const source = join(home, 'broken');
  const locked = join(source, 'locked');
  await mkdir(locked, { recursive: true });
  await writeFile(join(locked, 'secret'), 'x');
  await chmod(locked, 0o000);

  try {
    const failed = await firstmate(home, ['install', source, 'broken']);

    // A refusal, not a process that died: install says what went wrong.
    assert.equal(failed.code, 1, failed.stdout);
    assert.match(failed.stderr, /^firstmate: /);
    await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
    assert.deepEqual(await readdir(shelf), [], 'and nothing half fetched was left behind');
  } finally {
    // So that this test's own home directory can be taken away.
    await chmod(locked, 0o700);
  }
});

test('nothing the Plugin ships is run while it is installed', async (t) => {
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', fixture('marker')]);

  assert.equal(installed.code, 0, installed.stderr);
  await assert.rejects(stat(join(home, 'shelf', 'marker', 'ran')), 'the copy was never run');
  await assert.rejects(stat(join(fixture('marker'), 'ran')), 'nor was the source');
});

test('the Shelf is checked again on every install, not trusted from the file', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');
  await firstmate(home, ['shelf', shelf]);

  // What was a directory yesterday is a symlink to the home today.
  await rm(shelf, { recursive: true });
  await symlink(home, shelf);

  const refused = await firstmate(home, ['install', fixture('both')]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /is the Host's own home directory/);
  await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
});

test('a directory sitting in the Shelf is not a Plugin until it is registered', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'shelf');
  await cp(fixture('both'), join(shelf, 'both'), { recursive: true });

  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('No Plugins are registered'), 'the Host reads the Registry alone');
  assert.equal((await host.fetch('/p/both/')).status, 404, 'and serves nothing off the Shelf');
});
