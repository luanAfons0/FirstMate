/**
 * A command that changes the Registry or the settings asks the running Host
 * to reload, so the operator never restarts FirstMate by hand. A reload starts
 * what was added, stops what was removed, takes the new Grants, and leaves
 * every other Plugin Server alone, Stopped or not.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  bootHost,
  bootHostIn,
  firstmate,
  fixture,
  makeHome,
  until,
  type Booted,
} from './helpers/host.ts';

type View = { readonly name: string; readonly state: string };

/** Every Plugin and its state, as the Tray reads them. */
async function states(host: Booted): Promise<Record<string, string>> {
  const { plugins } = (await (await host.fetch('/plugins.json')).json()) as { plugins: View[] };
  return Object.fromEntries(plugins.map((plugin) => [plugin.name, plugin.state]));
}

/** How many times the Host's output says this. */
function times(host: Booted, said: RegExp): number {
  return host.output().match(new RegExp(said.source, 'g'))?.length ?? 0;
}

/** One Tool Bus call from the caller fixture, made from its own Plugin Page. */
async function reach(host: Booted, from: string, to: string): Promise<string> {
  const answer = await host.fetch(`/p/${from}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${from}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'reach', arguments: { plugin: to, tool: 'ping' } },
    }),
  });
  const said = (await answer.json()) as {
    result?: { content?: { text: string }[] };
    error?: { message: string };
  };
  return said.error?.message ?? said.result?.content?.[0]?.text ?? '';
}

test('add starts the Plugin in the running Host, with no restart', async (t) => {
  const host = await bootHost(t);

  const added = await firstmate(host.home, ['add', 'both', fixture('both')]);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stdout, `firstmate: added both at ${fixture('both')}\n`);
  assert.deepEqual(await states(host), { both: 'running' });
  assert.equal((await host.fetch('/p/both/')).status, 200, 'and its Plugin Page is served');
});

test('remove stops the Plugin, and its end is no Notice', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const removed = await firstmate(host.home, ['remove', 'both']);

  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(await states(host), { 'server-only': 'running' });
  assert.equal((await host.fetch('/p/both/')).status, 404, 'its address answers nothing');
  await until(host, /the Plugin named both is Stopped/);
  const { notices } = (await (await host.fetch('/notices.json')).json()) as {
    notices: { title: string }[];
  };
  assert.deepEqual(notices, [], 'the operator removed it, so it is not news');
});

test('grant lets a Tool Bus call through, and revoke stops it again', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller' },
    { name: 'server-only', directory: 'server-only' },
  ]);
  assert.match(await reach(host, 'asker', 'server-only'), /holds no Grant/);

  const granted = await firstmate(host.home, ['grant', 'asker', 'server-only']);
  assert.equal(granted.code, 0, granted.stderr);
  assert.equal(await reach(host, 'asker', 'server-only'), 'pong from server-only');

  const revoked = await firstmate(host.home, ['revoke', 'asker', 'server-only']);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.match(await reach(host, 'asker', 'server-only'), /holds no Grant/);
});

test('a reload leaves every other Plugin Server alone, and a Stopped one Stopped', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  await until(host, /quitter: the Plugin Server gave up/);

  await firstmate(host.home, ['add', 'server-only', fixture('server-only')]);
  await firstmate(host.home, ['grant', 'both', 'server-only']);
  await firstmate(host.home, ['order', 'quitter', '1']);

  assert.deepEqual(await states(host), {
    quitter: 'stopped',
    both: 'running',
    'server-only': 'running',
  });
  assert.equal(times(host, /both: the Plugin Server is up/), 1, 'both was started once');
  assert.equal(times(host, /quitter: the Plugin Server gave up/), 1, 'quitter was never retried');
});

test('a Plugin moved to another directory is started from there', async (t) => {
  const host = await bootHost(t, [{ name: 'tool', directory: 'page-only' }]);
  assert.deepEqual(await states(host), { tool: 'no-plugin-server' });

  await firstmate(host.home, ['remove', 'tool']);
  await firstmate(host.home, ['add', 'tool', fixture('server-only')]);

  assert.deepEqual(await states(host), { tool: 'running' });
});

test('the reload address answers a terminal with the token, and nobody else', async (t) => {
  const host = await bootHost(t);

  const stranger = await host.raw({ method: 'POST', path: '/reload', anonymous: true });
  assert.equal(stranger.status, 403, 'no token');

  const page = await host.raw({
    method: 'POST',
    path: '/reload',
    headers: { origin: host.origin, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(page.status, 403, 'a page holds the cookie, and is still refused');
  assert.match(page.body, /Only a terminal may ask the Host for a reload/);

  const fetched = await host.raw({
    method: 'POST',
    path: '/reload',
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(fetched.status, 403, 'so is a request with no Origin from a browser');

  const read = await host.raw({ method: 'GET', path: '/reload' });
  assert.equal(read.status, 405);
  assert.equal(read.headers['allow'], 'POST');

  const terminal = await host.raw({ method: 'POST', path: '/reload' });
  assert.equal(terminal.status, 200, terminal.body);
  assert.deepEqual(JSON.parse(terminal.body), { plugins: [] });
});

test('a damaged Registry under a running Host changes nothing, and says why', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  await writeFile(join(host.home, 'registry.json'), 'not json');

  const reloaded = await host.raw({ method: 'POST', path: '/reload' });

  assert.equal(reloaded.status, 500);
  assert.match(reloaded.body, /is not valid JSON/);
  assert.deepEqual(await states(host), { both: 'running' }, 'the Host holds what it held');
});

test('a runtime file a crashed Host left behind is no Host: the command writes, and that is all', async (t) => {
  const home = await makeHome(t);
  const port = await new Promise<number>((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
  await writeFile(join(home, 'runtime.json'), JSON.stringify({ port, token: 'stale' }));

  const added = await firstmate(home, ['add', 'both', fixture('both')]);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stdout, `firstmate: added both at ${fixture('both')}\n`);
  assert.equal(added.stderr, '');
});

test('a removed Plugin Server that will not end is killed before the command ends', async (t) => {
  const host = await bootHost(t, [{ name: 'stubborn', directory: 'stubborn' }]);

  const removed = await firstmate(host.home, ['remove', 'stubborn']);

  assert.equal(removed.code, 0, removed.stderr);
  if (process.platform === 'win32') {
    // Windows has no signal that asks, so the Host closes stdin, waits, and
    // then ends the whole tree (ADR-0019).
    assert.doesNotMatch(host.output(), /stubborn: SIGTERM/);
    assert.match(host.output(), /the Plugin named stubborn is Stopped: exit 1\./);
  } else {
    assert.match(host.output(), /stubborn: SIGTERM, and staying/);
    assert.match(host.output(), /the Plugin named stubborn is Stopped: SIGKILL/);
  }
});

test('a command run while the Host starts is picked up once it has started', async (t) => {
  const home = await makeHome(t);
  await writeFile(
    join(home, 'registry.json'),
    JSON.stringify({ plugins: [{ name: 'silent', directory: fixture('silent'), grants: [] }] }),
  );
  // The silent fixture holds the start up until its handshake runs out, and
  // the command runs in that time: after the Host read the Registry, and
  // before there is a runtime file to read.
  const booting = bootHostIn(t, home, { FIRSTMATE_HANDSHAKE_MS: '4000' });
  await delay(1000);
  const added = await firstmate(home, ['add', 'both', fixture('both')]);
  assert.equal(added.stdout, `firstmate: added both at ${fixture('both')}\n`, 'no Host yet');
  const host = await booting;

  await until(host, /reloaded 2 Plugin\(s\)/);
  assert.deepEqual(await states(host), { silent: 'stopped', both: 'running' });
});
