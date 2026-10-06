/**
 * `firstmate status` says whether the Host runs and the state of each Plugin,
 * and the commands that read say it as one JSON value with --json.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate, fixture, makeHome, DEFAULT_PLACE } from './helpers/host.ts';

/** A port nothing listens on, as a Host that crashed leaves behind. */
function closedPort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

test('status with no Host says so in one sentence, and ends with its own code', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['status']);

  assert.equal(said.code, 6);
  assert.equal(said.stdout, 'firstmate: no Host runs.\n');
  assert.equal(said.stderr, '');
});

test('a runtime file a crashed Host left behind reads as no Host', async (t) => {
  const home = await makeHome(t);
  const port = await closedPort();
  await writeFile(join(home, 'runtime.json'), JSON.stringify({ port, token: 'stale' }));

  const said = await firstmate(home, ['status']);

  assert.equal(said.code, 6, said.stderr);
  assert.equal(said.stdout, 'firstmate: no Host runs.\n');
});

test('status with a Host shows each Plugin and its state, in the Plugin Order', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  await firstmate(host.home, ['order', 'quitter', '1']);

  const said = await firstmate(host.home, ['status']);

  assert.equal(said.code, 0, said.stderr);
  assert.equal(
    said.stdout,
    `firstmate: the Host runs at http://127.0.0.1:${host.port}/\n` +
      'quitter\tStopped\n' +
      'both\tRunning\n' +
      'page-only\tno Plugin Server\n',
  );
  assert.ok(!said.stdout.includes(host.token), 'the token is never printed');
});

test('status --json is one JSON value, with a Host and without one', async (t) => {
  const home = await makeHome(t);
  const none = await firstmate(home, ['status', '--json']);
  assert.equal(none.code, 6);
  assert.deepEqual(JSON.parse(none.stdout), { running: false });

  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  const said = await firstmate(host.home, ['status', '--json']);

  assert.equal(said.code, 0, said.stderr);
  assert.deepEqual(JSON.parse(said.stdout), {
    running: true,
    address: `http://127.0.0.1:${host.port}/`,
    plugins: [
      { name: 'both', hasPage: true, state: 'running' },
      { name: 'quitter', hasPage: false, state: 'stopped' },
    ],
  });
});

test('list, order and shelf say what they read as one JSON value', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['grant', 'both', 'page-only']);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', 'new']);
  await firstmate(home, ['order', 'page-only', '1']);

  const listed = await firstmate(home, ['list', '--json']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), {
    plugins: [
      { name: 'both', place: DEFAULT_PLACE, directory: fixture('both'), grants: ['page-only'] },
      { name: 'page-only', place: DEFAULT_PLACE, directory: fixture('page-only'), grants: [] },
    ],
    shortcuts: [{ keys: 'Ctrl+Alt+N', plugin: 'both', path: 'new', address: '/p/both/new' }],
  });

  const ordered = await firstmate(home, ['order', '--json']);
  assert.equal(ordered.code, 0, ordered.stderr);
  assert.deepEqual(JSON.parse(ordered.stdout), { order: ['page-only', 'both'] });

  const shelved = await firstmate(home, ['shelf', '--json']);
  assert.equal(shelved.code, 0, shelved.stderr);
  assert.deepEqual(JSON.parse(shelved.stdout), { shelf: join(home, 'shelf') });
});

test('--json on a command that changes something is typed wrong', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  for (const argv of [
    ['add', 'page-only', fixture('page-only'), '--json'],
    ['order', 'both', '1', '--json'],
    ['shelf', home, '--json'],
  ]) {
    const refused = await firstmate(home, argv);
    assert.equal(refused.code, 2, argv.join(' '));
    assert.equal(refused.stdout, '', 'and prints no JSON');
  }
});

test('a port another Host holds now, under another token, reads as no Host', async (t) => {
  const other = await bootHost(t);
  const home = await makeHome(t);
  await writeFile(join(home, 'runtime.json'), JSON.stringify({ port: other.port, token: 'old' }));

  const said = await firstmate(home, ['status']);

  assert.equal(said.code, 6, said.stderr);
  assert.equal(said.stdout, 'firstmate: no Host runs.\n');
});
