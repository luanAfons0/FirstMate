/**
 * `firstmate restart <plugin>` is the operator's own restart of one Plugin,
 * Stopped or not, after they fixed it. The Host never does this by itself.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate, fixture, makeHome, until, type Booted } from './helpers/host.ts';

/** The state the Host says one Plugin is in. */
async function stateOf(host: Booted, name: string): Promise<string | undefined> {
  const { plugins } = (await (await host.fetch('/plugins.json')).json()) as {
    plugins: { name: string; state: string }[];
  };
  return plugins.find((plugin) => plugin.name === name)?.state;
}

/** How many times the Host's output says this. */
function times(host: Booted, said: RegExp): number {
  return host.output().match(new RegExp(said.source, 'g'))?.length ?? 0;
}

test('restart stops a running Plugin Server and starts it again', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  await until(host, /both: the Plugin Server is up/);

  const restarted = await firstmate(host.home, ['restart', 'both']);

  assert.equal(restarted.code, 0, restarted.stderr);
  assert.equal(restarted.stdout, 'firstmate: restarted both. It is Running.\n');
  assert.equal(await stateOf(host, 'both'), 'running');
  await until(host, /both: the Plugin Server is up[\s\S]*both: the Plugin Server is up/);
  const { notices } = (await (await host.fetch('/notices.json')).json()) as {
    notices: unknown[];
  };
  assert.deepEqual(notices, [], 'the operator stopped it, so its end is not news');
});

test('a Stopped Plugin that is fixed comes back Running', async (t) => {
  const home = await makeHome(t);
  const plugin = join(home, 'mending');
  await mkdir(plugin);
  await copyFile(join(fixture('quitter'), 'mcp'), join(plugin, 'mcp'));
  const host = await bootHost(t, [{ name: 'mending', directory: plugin }]);
  assert.equal(await stateOf(host, 'mending'), 'stopped');

  await copyFile(join(fixture('server-only'), 'mcp'), join(plugin, 'mcp'));
  const restarted = await firstmate(host.home, ['restart', 'mending']);

  assert.equal(restarted.code, 0, restarted.stderr);
  assert.equal(await stateOf(host, 'mending'), 'running');
});

test('a Plugin still broken stays Stopped, and the command says why', async (t) => {
  const host = await bootHost(t, [{ name: 'quitter', directory: 'quitter' }]);
  await until(host, /quitter: the Plugin Server gave up/);

  const restarted = await firstmate(host.home, ['restart', 'quitter']);

  assert.equal(restarted.code, 1);
  assert.equal(restarted.stderr, 'firstmate: quitter is Stopped: exit 3.\n');
  assert.equal(times(host, /quitter: the Plugin Server gave up/), 2, 'started once more, no more');
  assert.equal(await stateOf(host, 'quitter'), 'stopped');
});

test('a Plugin with no Plugin Server has nothing to restart', async (t) => {
  const host = await bootHost(t, [{ name: 'page-only', directory: 'page-only' }]);

  const restarted = await firstmate(host.home, ['restart', 'page-only']);

  assert.equal(restarted.code, 0, restarted.stderr);
  assert.equal(restarted.stdout, 'firstmate: page-only ships no Plugin Server to restart.\n');
});

test('an unknown Plugin Name is refused in one sentence', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const unknown = await firstmate(host.home, ['restart', 'nobody']);
  assert.equal(unknown.code, 4);
  assert.equal(unknown.stderr, 'firstmate: no Plugin named nobody is registered.\n');

  const malformed = await firstmate(host.home, ['restart', 'Not A Name']);
  assert.equal(malformed.code, 3);
  assert.match(malformed.stderr, /is not a Plugin Name/);
});

test('restart with no Host says so, and ends with its own code', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const restarted = await firstmate(home, ['restart', 'both']);

  assert.equal(restarted.code, 6);
  assert.equal(restarted.stderr, 'firstmate: no Host runs.\n');
});

test('the restart address answers a terminal with the token, and nobody else', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const stranger = await host.raw({ method: 'POST', path: '/restart/both', anonymous: true });
  assert.equal(stranger.status, 403, 'no token');

  const page = await host.raw({
    method: 'POST',
    path: '/restart/both',
    headers: { origin: host.origin, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(page.status, 403, 'a Plugin Page may never restart a Plugin');

  const read = await host.raw({ method: 'GET', path: '/restart/both' });
  assert.equal(read.status, 405);

  const unknown = await host.raw({ method: 'POST', path: '/restart/nobody' });
  assert.equal(unknown.status, 404);

  assert.equal(times(host, /both: the Plugin Server is up/), 1, 'none of them restarted it');
});
