/**
 * One command runs the Host.
 *
 * The published binary is the command line, so a person who installs FirstMate
 * from npm has nothing else to run. `firstmate start` therefore has to boot the
 * same Host that the Host's own entry point boots, and not a near copy of it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate, makeHome } from './helpers/host.ts';

test('the Host starts from the command line, and serves what is registered', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }], {}, {
    viaCommandLine: true,
  });

  const page = await host.fetch('/');
  assert.equal(page.status, 200, 'the Index Page is served');
  assert.ok((await page.text()).includes('href="/p/both/"'), 'and it lists the Plugin');

  const runtime = JSON.parse(await readFile(join(host.home, 'runtime.json'), 'utf8')) as {
    port: number;
    token: string;
  };
  assert.equal(runtime.port, host.port, 'the runtime file is written into the home directory');
  assert.match(runtime.token, /^[0-9a-f]{64}$/);
});

test('the same environment variables move it, and its output is unchanged', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }], {}, {
    viaCommandLine: true,
  });

  // FIRSTMATE_HOME and FIRSTMATE_PORT are what the seam sets, so a Host that
  // answers here read both of them.
  assert.equal((await host.fetch('/')).status, 200);
  assert.match(host.output(), /FirstMate: http:\/\/127\.0\.0\.1:\d+\//, 'it announces the address');
  assert.match(host.output(), /FirstMate: 1 Plugin\(s\)/, 'and says what it read');
});

test('the Host it starts is the Host the entry point starts', async (t) => {
  const rows = [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
  ];
  const viaEntryPoint = await bootHost(t, rows);
  const viaCommandLine = await bootHost(t, rows, {}, { viaCommandLine: true });

  // The Index Page names the Registry it read, and each Host read its own
  // temporary one, so the home directory is the one thing that may differ.
  const settle = (page: string, home: string): string => page.split(home).join('<home>');

  assert.equal(
    settle(await (await viaCommandLine.fetch('/')).text(), viaCommandLine.home),
    settle(await (await viaEntryPoint.fetch('/')).text(), viaEntryPoint.home),
    'the same bytes, either way it was started',
  );
});

test('the usage text names start, and an unknown command is still refused', async (t) => {
  const home = await makeHome(t);

  const usage = await firstmate(home, ['--help']);
  assert.equal(usage.code, 0, usage.stderr);
  for (const command of ['start', 'add', 'remove', 'list']) {
    assert.match(usage.stdout, new RegExp(`firstmate ${command}\\b`), `usage names ${command}`);
  }

  const unknown = await firstmate(home, ['frobnicate']);
  assert.notEqual(unknown.code, 0, 'an unknown command fails');
  assert.match(unknown.stderr, /no such command: frobnicate/);
  assert.match(unknown.stderr, /firstmate start\b/, 'and the usage text comes with it');
});

test('start takes nothing, and says so', async (t) => {
  const home = await makeHome(t);

  const extra = await firstmate(home, ['start', 'now']);

  assert.notEqual(extra.code, 0);
  assert.match(extra.stderr, /start takes nothing/);
});
