/**
 * The Plugin Order: chosen from a terminal, kept in the settings file, and
 * shown by every list of Plugins with no restart of the Host (ADR-0016).
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate, fixture, makeHome, type Booted } from './helpers/host.ts';

/** Three Plugins, in the order they were added. */
const ROWS = [
  { name: 'both', directory: 'both' },
  { name: 'page-only', directory: 'page-only' },
  { name: 'server-only', directory: 'server-only' },
];

type Written = {
  shelf?: string;
  shortcuts?: { keys: string; plugin: string; path: string }[];
  order?: string[];
};

/** The settings file, read back exactly as the Host would read it. */
async function settings(home: string): Promise<Written> {
  return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as Written;
}

/** The Plugin Names in /plugins.json, in the order the Tray gets them. */
async function listed(host: Booted): Promise<string[]> {
  const answer = await host.fetch('/plugins.json');
  assert.equal(answer.status, 200);
  const body = (await answer.json()) as { plugins: { name: string }[] };
  return body.plugins.map((plugin) => plugin.name);
}

/** The Plugin Names on the Index Page, top to bottom. */
async function onTheIndexPage(host: Booted): Promise<string[]> {
  const answer = await host.fetch('/');
  assert.equal(answer.status, 200);
  return [...(await answer.text()).matchAll(/data-name="([^"]+)"/g)].map((found) => found[1] ?? '');
}

/** A home with the three Plugins registered from a terminal, in ROWS order. */
async function homeWithThree(t: Parameters<typeof makeHome>[0]): Promise<string> {
  const home = await makeHome(t);
  for (const row of ROWS) {
    const added = await firstmate(home, ['add', row.name, fixture(row.directory)]);
    assert.equal(added.code, 0, added.stderr);
  }
  return home;
}

test('with no order chosen, the Plugin Order is the Registry order', async (t) => {
  const home = await homeWithThree(t);

  const said = await firstmate(home, ['order']);

  assert.equal(said.code, 0, said.stderr);
  assert.equal(said.stdout, '1\tboth\n2\tpage-only\n3\tserver-only\n');
  await assert.rejects(readFile(join(home, 'settings.json')), 'saying the order writes nothing');
});

test('a move shows on the Index Page and in /plugins.json with no restart', async (t) => {
  const host = await bootHost(t, ROWS);
  assert.deepEqual(await listed(host), ['both', 'page-only', 'server-only']);

  const moved = await firstmate(host.home, ['order', 'server-only', '1']);

  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(moved.stdout, 'firstmate: moved server-only to position 1\n');
  assert.deepEqual(await listed(host), ['server-only', 'both', 'page-only']);
  assert.deepEqual(await onTheIndexPage(host), ['server-only', 'both', 'page-only']);
  assert.deepEqual((await settings(host.home)).order, ['server-only', 'both', 'page-only']);
});

test('a move changes only the Plugin it names', async (t) => {
  const home = await homeWithThree(t);
  await firstmate(home, ['order', 'server-only', '1']);

  const moved = await firstmate(home, ['order', 'both', '3']);

  assert.equal(moved.code, 0, moved.stderr);
  const said = await firstmate(home, ['order']);
  assert.equal(said.stdout, '1\tserver-only\n2\tpage-only\n3\tboth\n');

  const again = await firstmate(home, ['order', 'page-only', '2']);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual((await settings(home)).order, ['server-only', 'page-only', 'both']);
});

test('order refuses a name or a position it cannot use, and writes nothing', async (t) => {
  const home = await homeWithThree(t);

  const refusals: [readonly string[], RegExp][] = [
    [['Both', '1'], /Both is not a Plugin Name/],
    [['nobody', '1'], /no Plugin named nobody is registered/],
    [['both', '0'], /0 is not a position\. Give a whole number from 1 to 3\./],
    [['both', '4'], /4 is not a position\. Give a whole number from 1 to 3\./],
    [['both', '1.5'], /1\.5 is not a position/],
    [['both', '-1'], /-1 is not a position/],
    [['both', 'top'], /top is not a position/],
  ];
  for (const [argv, said] of refusals) {
    const refused = await firstmate(home, ['order', ...argv]);
    assert.equal(refused.code, 1, argv.join(' '));
    assert.match(refused.stderr, said);
  }
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');

  const wrong = await firstmate(home, ['order', 'both']);
  assert.equal(wrong.code, 2, 'a name with no position is a usage fault');
  assert.match(wrong.stderr, /order takes nothing, or a Plugin Name and a position/);
});

test('order keeps the Shelf and the Shortcuts', async (t) => {
  const home = await homeWithThree(t);
  await mkdir(join(home, 'plugins'));
  const shelf = await realpath(join(home, 'plugins'));
  await firstmate(home, ['shelf', shelf]);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both']);

  const moved = await firstmate(home, ['order', 'page-only', '1']);

  assert.equal(moved.code, 0, moved.stderr);
  assert.deepEqual(await settings(home), {
    shelf,
    shortcuts: [{ keys: 'Ctrl+Alt+N', plugin: 'both', path: '' }],
    order: ['page-only', 'both', 'server-only'],
  });
});

test('remove takes a Plugin out of the order, and a Plugin added goes last', async (t) => {
  const home = await homeWithThree(t);
  await firstmate(home, ['order', 'server-only', '1']);

  const removed = await firstmate(home, ['remove', 'server-only']);

  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual((await settings(home)).order, ['both', 'page-only']);

  const added = await firstmate(home, ['add', 'server-only', fixture('server-only')]);
  assert.equal(added.code, 0, added.stderr);
  const said = await firstmate(home, ['order']);
  assert.equal(said.stdout, '1\tboth\n2\tpage-only\n3\tserver-only\n', 'no old place is kept');
});

test('a name in the order that the Registry does not hold is passed over', async (t) => {
  const host = await bootHost(t, ROWS);
  await writeFile(
    join(host.home, 'settings.json'),
    `${JSON.stringify({ order: ['gone', 'page-only'] })}\n`,
  );

  assert.deepEqual(await listed(host), ['page-only', 'both', 'server-only']);
  const said = await firstmate(host.home, ['order']);
  assert.equal(said.stdout, '1\tpage-only\n2\tboth\n3\tserver-only\n');
});

test('list keeps the Registry order', async (t) => {
  const home = await homeWithThree(t);
  await firstmate(home, ['order', 'server-only', '1']);

  const said = await firstmate(home, ['list']);

  assert.equal(said.code, 0, said.stderr);
  const names = said.stdout
    .trim()
    .split('\n')
    .map((line) => line.split('\t')[0]);
  assert.deepEqual(names, ['both', 'page-only', 'server-only']);
});

test('a damaged order fails every command loudly', async (t) => {
  const home = await homeWithThree(t);
  const damage: [unknown, RegExp][] = [
    ['both', /need "order" to be an array of Plugin Names/],
    [['both', 'Not A Name'], /need "order" to be an array of Plugin Names/],
    [['both', 'page-only', 'both'], /name both twice in "order"/],
  ];

  for (const [order, said] of damage) {
    await writeFile(join(home, 'settings.json'), `${JSON.stringify({ order })}\n`);
    for (const argv of [['order'], ['list'], ['order', 'both', '1']]) {
      const broken = await firstmate(home, argv);
      assert.equal(broken.code, 1, argv.join(' '));
      assert.match(broken.stderr, said);
      assert.match(broken.stderr, /settings\.json/);
    }
  }
});

test('an order damaged while the Host runs is said, not served', async (t) => {
  const host = await bootHost(t, ROWS);

  await writeFile(join(host.home, 'settings.json'), '{"order": "both"}\n');

  for (const path of ['/', '/plugins.json']) {
    const answer = await host.fetch(path);
    assert.equal(answer.status, 500, path);
    assert.match(await answer.text(), /need "order" to be an array of Plugin Names/);
  }
});

test('no address on the Host writes the Plugin Order', async (t) => {
  const host = await bootHost(t, ROWS);
  await firstmate(host.home, ['order', 'page-only', '1']);
  const before = await readFile(join(host.home, 'settings.json'), 'utf8');
  const body = JSON.stringify({ order: ['server-only'] });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const listing = await host.fetch('/plugins.json', { method, body });
    assert.equal(listing.status, 405, `${method} /plugins.json`);
    for (const path of ['/order', '/plugins/order', '/api/order']) {
      const answer = await host.fetch(path, { method, body });
      assert.equal(answer.status, 404, `${method} ${path}`);
    }
  }

  assert.equal(
    await readFile(join(host.home, 'settings.json'), 'utf8'),
    before,
    'no request changed the settings file',
  );
});
