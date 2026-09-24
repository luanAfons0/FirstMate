/**
 * The Shortcuts as JSON, for the Tray: what `bind` wrote, said again over
 * loopback so that the Tray never reads a file across WSL (ADR-0013). It is
 * read-only, now and later, because every Plugin Page shares this origin.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate } from './helpers/host.ts';

type Listed = { keys: string; plugin: string; address: string };

async function shortcutsOf(host: {
  fetch: (path: string) => Promise<Response>;
}): Promise<Listed[]> {
  const answer = await host.fetch('/shortcuts.json');
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^application\/json/);
  return ((await answer.json()) as { shortcuts: Listed[] }).shortcuts;
}

test('the Shortcuts are listed with the address each one opens', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  assert.deepEqual(await shortcutsOf(host), [], 'none bound is an empty list');

  // Bound while the Host runs: the Tray picks a Shortcut up with no restart.
  await firstmate(host.home, ['bind', 'alt+ctrl+n', 'both', 'new.html']);
  await firstmate(host.home, ['bind', 'Ctrl+Alt+D', 'both']);

  assert.deepEqual(await shortcutsOf(host), [
    { keys: 'Ctrl+Alt+N', plugin: 'both', address: '/p/both/new.html' },
    { keys: 'Ctrl+Alt+D', plugin: 'both', address: '/p/both/' },
  ]);

  await firstmate(host.home, ['unbind', 'Ctrl+Alt+N']);
  assert.deepEqual(await shortcutsOf(host), [
    { keys: 'Ctrl+Alt+D', plugin: 'both', address: '/p/both/' },
  ]);
});

test('the Tray gets the Shortcuts from the token alone, with no redirect', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  await firstmate(host.home, ['bind', 'Ctrl+Alt+N', 'both']);

  const answer = await host.raw({ path: `/shortcuts.json?token=${host.token}`, anonymous: true });

  assert.equal(answer.status, 200, 'the token alone is enough');
  assert.ok(answer.body.includes('"Ctrl+Alt+N"'), answer.body);
});

test('the Shortcuts are refused with no token, a wrong Host or a foreign Origin', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  await firstmate(host.home, ['bind', 'Ctrl+Alt+N', 'both']);

  const stranger = await host.raw({ path: '/shortcuts.json', anonymous: true });
  assert.equal(stranger.status, 403);
  assert.match(stranger.body, /no token/);

  const rebound = await host.raw({
    path: '/shortcuts.json',
    headers: { host: 'attacker.test:1234' },
  });
  assert.equal(rebound.status, 403);
  assert.match(rebound.body, /Host header/);

  const foreign = await host.raw({
    path: '/shortcuts.json',
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403);
  assert.match(foreign.body, /Origin/);

  for (const answer of [stranger, rebound, foreign]) {
    assert.ok(!answer.body.includes('Ctrl+Alt+N'), 'nothing of a Shortcut leaks');
  }
});

test('no address on the Host writes a Shortcut', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  await firstmate(host.home, ['bind', 'Ctrl+Alt+N', 'both']);
  const before = await readFile(join(host.home, 'settings.json'), 'utf8');
  const body = JSON.stringify({ keys: 'Ctrl+Alt+Q', plugin: 'both', path: '' });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const listed = await host.fetch('/shortcuts.json', { method, body });
    assert.equal(listed.status, 405, `${method} /shortcuts.json`);
    assert.equal(listed.headers.get('allow'), 'GET, HEAD');
    for (const path of ['/shortcuts', '/shortcut', '/bind', '/unbind', '/api/shortcuts']) {
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

test('a settings file damaged while the Host runs is said, not served', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  await writeFile(join(host.home, 'settings.json'), '{"shortcuts": "Ctrl+Alt+N"}\n');
  const answer = await host.fetch('/shortcuts.json');

  assert.equal(answer.status, 500);
  assert.match(await answer.text(), /need "shortcuts" to be an array/);
});
