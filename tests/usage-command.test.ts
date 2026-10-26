/**
 * `firstmate usage` prints the Usage of FirstMate and of every Plugin, once,
 * as `/processes.json` says it (ADR-0032). `firstmate status` stays as it is.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, firstmate, makeHome, DEFAULT_PLACE, NO_HOST } from './helpers/host.ts';

/** Why the figures of a local Plugin are read on Linux alone, so far. */
const NO_READER =
  process.platform !== 'linux' && 'the Host reads the Usage of a local Plugin on Linux alone';

/** A measured row, piped: name, state, CPU, memory, uptime, PID and process count. */
function measured(name: string, processes = '\\d+'): RegExp {
  return new RegExp(`^${name}\\tRunning\\t\\d+\\.\\d%\\t\\d+ MB\\t\\d+ s\\t\\d+\\t${processes}$`);
}

test('usage with no Host says so in one sentence, and ends with its own code', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['usage']);
  assert.equal(said.code, 6);
  assert.equal(said.stdout, `firstmate: ${NO_HOST}\n`);
  assert.equal(said.stderr, '');

  const json = await firstmate(home, ['usage', '--json']);
  assert.equal(json.code, 6);
  assert.deepEqual(JSON.parse(json.stdout), { running: false });
});

test('usage prints FirstMate first, then every Plugin in the Plugin Order', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  await firstmate(host.home, ['order', 'quitter', '1']);

  const said = await firstmate(host.home, ['usage']);

  assert.equal(said.code, 0, said.stderr);
  const lines = said.stdout.split('\n');
  assert.equal(lines.pop(), '', 'every row ends its line');
  assert.deepEqual(
    lines.map((line) => line.split('\t')[0]),
    ['FirstMate', 'quitter', 'both', 'page-only'],
  );
  assert.equal(lines[1], 'quitter\tStopped (exit 3.)\t-\t-\t-\t-\t-');
  assert.equal(lines[3], 'page-only\tno Plugin Server\t-\t-\t-\t-\t-');
  assert.ok(!said.stdout.includes(host.token), 'the token is never printed');
});

test('usage prints the figures of each Running Plugin', { skip: NO_READER }, async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'spawner', directory: 'spawner' },
  ]);

  const said = await firstmate(host.home, ['usage']);

  assert.equal(said.code, 0, said.stderr);
  const [own = '', both = '', spawner = ''] = said.stdout.split('\n');
  assert.match(own, measured('FirstMate', '1'));
  assert.match(both, measured('both'));
  assert.match(spawner, measured('spawner', '[2-9]'));
});

test('usage --json prints the rows as one JSON value', async (t) => {
  const host = await bootHost(t, [
    { name: 'quitter', directory: 'quitter' },
    { name: 'both', directory: 'both' },
  ]);

  const said = await firstmate(host.home, ['usage', '--json']);

  assert.equal(said.code, 0, said.stderr);
  const usage = JSON.parse(said.stdout) as {
    running: boolean;
    address: string;
    firstmate: { name: string; place: string };
    plugins: { name: string; state: string; why?: string }[];
  };
  assert.equal(usage.running, true);
  assert.equal(usage.address, `http://127.0.0.1:${host.port}/`);
  assert.equal(usage.firstmate.name, 'FirstMate');
  assert.equal(usage.firstmate.place, DEFAULT_PLACE);
  assert.deepEqual(
    usage.plugins.map(({ name, state, why }) => ({ name, state, why })),
    [
      { name: 'quitter', state: 'stopped', why: 'exit 3.' },
      { name: 'both', state: 'running', why: undefined },
    ],
  );
  assert.ok(!said.stdout.includes(host.token), 'the token is never printed');
});

test('usage takes nothing else', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['usage', 'both']);

  assert.equal(said.code, 2);
  assert.equal(said.stdout, '');
});
