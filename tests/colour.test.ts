/**
 * Colour in the command line comes from Node's own `styleText`, which checks
 * the stream: a pipe and NO_COLOR get none, and FORCE_COLOR asks for it. The
 * aligned tables under a header need a TTY, which this seam cannot give, so a
 * person checks those by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, firstmate, makeHome } from './helpers/host.ts';

const ESCAPE = '\u001b[';
const RED = (text: string): string => `\u001b[31m${text}\u001b[39m`;
const GREEN = (text: string): string => `\u001b[32m${text}\u001b[39m`;
const BOLD = (text: string): string => `\u001b[1m${text}\u001b[22m`;

test('FORCE_COLOR makes the state words of status red and green', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);

  const said = await firstmate(host.home, ['status'], { FORCE_COLOR: '1', NO_COLOR: undefined });

  assert.equal(said.code, 0, said.stderr);
  assert.ok(said.stdout.includes(`quitter\t${RED('Stopped')}\n`), said.stdout);
  assert.ok(said.stdout.includes(`both\t${GREEN('Running')}\n`), said.stdout);
});

test('FORCE_COLOR makes the prefix of a refusal red', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['remove', 'nothing'], {
    FORCE_COLOR: '1',
    NO_COLOR: undefined,
  });

  assert.equal(said.code, 4);
  assert.equal(said.stderr, `${RED('firstmate:')} no Plugin named nothing is registered.\n`);
});

test('FORCE_COLOR makes the group names of the short help bold', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['--help'], { FORCE_COLOR: '1', NO_COLOR: undefined });

  assert.equal(said.code, 0);
  for (const group of ['Start', 'Plugins', 'Running', 'Grants and Shortcuts', 'Places']) {
    assert.ok(said.stdout.includes(`\n${BOLD(group)}\n`), group);
  }
});

test('piped, and with NO_COLOR, no output holds an escape code', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  const runs = [
    ['status'],
    ['list'],
    ['order'],
    ['place'],
    ['shelf'],
    ['--help'],
    ['remove', 'nothing'],
    ['lsit'],
  ];

  for (const env of [{ FORCE_COLOR: undefined }, { NO_COLOR: '1', FORCE_COLOR: undefined }]) {
    for (const argv of runs) {
      const said = await firstmate(host.home, argv, env);
      assert.ok(!said.stdout.includes(ESCAPE), `${argv.join(' ')} stdout`);
      assert.ok(!said.stderr.includes(ESCAPE), `${argv.join(' ')} stderr`);
    }
  }
});

test('--json holds no escape code even when colour is forced', async (t) => {
  const host = await bootHost(t, [{ name: 'quitter', directory: 'quitter' }]);

  for (const argv of [
    ['status', '--json'],
    ['list', '--json'],
    ['place', '--json'],
  ]) {
    const said = await firstmate(host.home, argv, { FORCE_COLOR: '1', NO_COLOR: undefined });
    assert.ok(!said.stdout.includes(ESCAPE), argv.join(' '));
    JSON.parse(said.stdout);
  }
});
