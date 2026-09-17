/**
 * The Plugin list as JSON: what the Index Page shows a person, said again for
 * the Tray, which is a Windows process and cannot read a page (ADR-0007).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';

type Listed = { name: string; hasPage: boolean; state: string };

async function pluginsOf(host: { fetch: (path: string) => Promise<Response> }): Promise<Listed[]> {
  const answer = await host.fetch('/plugins.json');
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^application\/json/);
  return ((await answer.json()) as { plugins: Listed[] }).plugins;
}

test('the Plugin list names every Plugin, its state, and whether it has a page', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
    { name: 'server-only', directory: 'server-only' },
    { name: 'quitter', directory: 'quitter' },
  ]);

  const plugins = await pluginsOf(host);
  const of = (name: string) => plugins.find((plugin) => plugin.name === name);

  assert.equal(plugins.length, 4, 'every Plugin in the Registry is listed');
  assert.deepEqual(of('both'), { name: 'both', hasPage: true, state: 'running' });
  assert.deepEqual(of('page-only'), {
    name: 'page-only',
    hasPage: true,
    state: 'no-plugin-server',
  });
  assert.deepEqual(of('server-only'), { name: 'server-only', hasPage: false, state: 'running' });
  assert.deepEqual(of('quitter'), { name: 'quitter', hasPage: false, state: 'stopped' });
});

test('an empty Registry lists no Plugin rather than nothing at all', async (t) => {
  const host = await bootHost(t, []);

  assert.deepEqual(await pluginsOf(host), [], 'the list is empty, and it is still a list');
});

test('the Tray gets the list from the token alone, with no redirect', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  // The Tray never navigates, so the Host answers it rather than sending it
  // to a clean address with a cookie, exactly as it answers curl.
  const answer = await host.raw({
    path: `/plugins.json?token=${host.token}`,
    anonymous: true,
  });

  assert.equal(answer.status, 200, 'the token alone is enough');
  assert.ok(answer.body.includes('"both"'), 'and the list comes back');
});

test('the Plugin list is refused without the token, and is read-only', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const stranger = await host.raw({ path: '/plugins.json', anonymous: true });
  assert.equal(stranger.status, 403, 'a stranger is refused like everyone else');

  const written = await host.fetch('/plugins.json', { method: 'POST' });
  assert.equal(written.status, 405, 'nothing is written here');
  assert.equal(written.headers.get('allow'), 'GET, HEAD');
});
