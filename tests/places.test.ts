/**
 * Places: where Plugins are installed and their Plugin Servers run. The
 * default Place is this machine and is always there; the operator adds
 * others from a terminal, each with a Shelf of its own, and a Plugin Name is
 * used once across every Place (ADR-0021).
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHostIn, DEFAULT_PLACE, firstmate, fixture, makeHome, until } from './helpers/host.ts';

type Listed = { places: { name: string; kind: string; shelf: string }[] };

async function placesIn(home: string): Promise<Listed['places']> {
  const listed = await firstmate(home, ['place', '--json']);
  assert.equal(listed.code, 0, listed.stderr);
  return (JSON.parse(listed.stdout) as Listed).places;
}

async function rowsIn(home: string): Promise<{ name: string; place: string }[]> {
  const text = await readFile(join(home, 'registry.json'), 'utf8');
  return (JSON.parse(text) as { plugins: { name: string; place: string }[] }).plugins;
}

async function settingsIn(home: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

test('there is one Place before anything is chosen: this machine, with its Shelf', async (t) => {
  const home = await makeHome(t);

  assert.deepEqual(await placesIn(home), [
    { name: DEFAULT_PLACE, kind: 'local', shelf: join(home, 'shelf') },
  ]);
  const said = await firstmate(home, ['place']);
  assert.equal(said.stdout, `${DEFAULT_PLACE}\tlocal\t${join(home, 'shelf')}\n`);
  await assert.rejects(readFile(join(home, 'settings.json')), 'and nothing was written for it');
});

test('a local Place is added, listed, and has a Shelf of its own', async (t) => {
  const home = await makeHome(t);

  const added = await firstmate(home, ['place', 'add', 'work', 'local']);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stdout, 'firstmate: added the local Place work\n');
  assert.deepEqual(await placesIn(home), [
    { name: DEFAULT_PLACE, kind: 'local', shelf: join(home, 'shelf') },
    { name: 'work', kind: 'local', shelf: join(home, 'shelves', 'work') },
  ]);
  assert.deepEqual((await settingsIn(home))['places'], [{ name: 'work', kind: 'local' }]);
});

test('add uses the default Place unless --place names another', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['place', 'add', 'work', 'local']);

  const plain = await firstmate(home, ['add', 'both', fixture('both')]);
  const placed = await firstmate(home, [
    'add',
    'server-only',
    fixture('server-only'),
    '--place',
    'work',
  ]);

  assert.equal(plain.stdout, `firstmate: added both at ${fixture('both')}\n`);
  assert.equal(
    placed.stdout,
    `firstmate: added server-only at ${fixture('server-only')}, in work\n`,
  );
  assert.deepEqual(
    (await rowsIn(home)).map((row) => [row.name, row.place]),
    [
      ['both', DEFAULT_PLACE],
      ['server-only', 'work'],
    ],
  );
});

test("install lands a Plugin in its own Place's Shelf", async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['place', 'add', 'work', 'local']);

  const installed = await firstmate(home, ['install', fixture('both'), '--place', 'work']);

  const landed = join(home, 'shelves', 'work', 'both');
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(installed.stdout, `firstmate: installed both at ${landed}, in work\n`);
  await readFile(join(landed, 'private.txt'), 'utf8');
  assert.deepEqual(
    (await rowsIn(home)).map((row) => row.place),
    ['work'],
  );
});

test('a Plugin Name is refused when any Place holds it', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['place', 'add', 'work', 'local']);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const again = await firstmate(home, ['add', 'both', fixture('server-only'), '--place', 'work']);

  assert.equal(again.code, 5);
  assert.equal(
    again.stderr,
    `firstmate: both is already registered in ${DEFAULT_PLACE}, at ${fixture('both')}.\n`,
  );
});

test('a Place that holds a Plugin is not removed, and an empty one is', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['place', 'add', 'work', 'local']);
  await firstmate(home, ['add', 'both', fixture('both'), '--place', 'work']);

  const refused = await firstmate(home, ['place', 'remove', 'work']);
  assert.equal(refused.code, 5);
  assert.equal(refused.stderr, 'firstmate: work holds both. Remove it first.\n');

  await firstmate(home, ['remove', 'both']);
  const removed = await firstmate(home, ['place', 'remove', 'work']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(removed.stdout, 'firstmate: removed the Place work. Nothing on disk was touched.\n');
  assert.equal((await settingsIn(home))['places'], undefined, 'no empty array is left behind');
});

test('the default Place is always there, and cannot be removed', async (t) => {
  const home = await makeHome(t);

  const refused = await firstmate(home, ['place', 'remove', DEFAULT_PLACE]);

  assert.equal(refused.code, 3);
  assert.equal(
    refused.stderr,
    `firstmate: ${DEFAULT_PLACE} is this machine, and is always there.\n`,
  );
});

test('an unknown Place, a bad name, an unknown kind and a taken name are each refused', async (t) => {
  const home = await makeHome(t);

  const unknown = await firstmate(home, ['add', 'both', fixture('both'), '--place', 'nowhere']);
  assert.equal(unknown.code, 4);
  assert.equal(unknown.stderr, 'firstmate: no Place named nowhere is there.\n');

  const bad = await firstmate(home, ['place', 'add', 'Work', 'local']);
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /Work is not a Place Name/);

  const kind = await firstmate(home, ['place', 'add', 'work', 'mars']);
  assert.equal(kind.code, 3);
  assert.equal(kind.stderr, 'firstmate: mars is not a kind of Place. The kinds are local, wsl.\n');

  const taken = await firstmate(home, ['place', 'add', DEFAULT_PLACE, 'local']);
  assert.equal(taken.code, 5);
  assert.equal(taken.stderr, `firstmate: a Place named ${DEFAULT_PLACE} is there already.\n`);

  const nothing = await firstmate(home, ['place', 'add', 'work']);
  assert.equal(nothing.code, 2, 'a Place needs a kind');

  const elsewhere = await firstmate(home, ['grant', 'a', 'b', '--place', 'work']);
  assert.equal(elsewhere.code, 2, 'grant takes no --place');
  assert.match(elsewhere.stderr, /grant takes no --place/);
});

test("each Place's Shelf moves on its own", async (t) => {
  const home = await makeHome(t);
  const chosen = join(home, 'work-plugins');
  await mkdir(chosen);
  await firstmate(home, ['place', 'add', 'work', 'local']);

  const moved = await firstmate(home, ['shelf', chosen, '--place', 'work']);

  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(moved.stdout, `firstmate: the Shelf of work is now ${chosen}\n`);
  const said = await firstmate(home, ['shelf', '--place', 'work', '--json']);
  assert.deepEqual(JSON.parse(said.stdout), { shelf: chosen });
  const settings = await settingsIn(home);
  assert.deepEqual(settings['places'], [{ name: 'work', kind: 'local', shelf: chosen }]);
  assert.equal(settings['shelf'], undefined, "the default Place's Shelf has not moved");
});

test('a Registry row written before Places is in the default Place', async (t) => {
  const home = await makeHome(t);
  await writeFile(
    join(home, 'registry.json'),
    JSON.stringify({ plugins: [{ name: 'both', directory: fixture('both'), grants: [] }] }),
  );

  const listed = await firstmate(home, ['list', '--json']);

  assert.deepEqual(JSON.parse(listed.stdout).plugins, [
    { name: 'both', place: DEFAULT_PLACE, directory: fixture('both'), grants: [] },
  ]);
});

test('a Plugin in another local Place runs, and a move of Place restarts it', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['place', 'add', 'work', 'local']);
  await firstmate(home, ['add', 'server-only', fixture('server-only'), '--place', 'work']);
  const host = await bootHostIn(t, home);
  await until(host, /the Plugin Server of server-only is running/);

  const rows = await rowsIn(home);
  await writeFile(
    join(home, 'registry.json'),
    JSON.stringify({ plugins: rows.map((row) => ({ ...row, place: DEFAULT_PLACE })) }),
  );
  const reloaded = await host.raw({ method: 'POST', path: '/reload' });

  assert.equal(reloaded.status, 200, reloaded.body);
  const starts = host.output().match(/server-only: the Plugin Server is up/g) ?? [];
  assert.equal(starts.length, 2, 'it is another Plugin under an old name');
});

test(
  'a wsl Place is refused off Windows, with one sentence',
  { skip: process.platform === 'win32' && 'Windows is where a wsl Place is offered' },
  async (t) => {
    const home = await makeHome(t);

    const refused = await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian']);

    assert.equal(refused.code, 3);
    assert.equal(
      refused.stderr,
      'firstmate: a wsl Place runs on Windows only, and this machine is not Windows.\n',
    );
    const settings = await readFile(join(home, 'settings.json'), 'utf8').catch(() => '{}');
    assert.equal(JSON.parse(settings).places, undefined, 'nothing is written');
  },
);
