/** The Index Page: every registered Plugin, and a link to each Plugin Page. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';

test('the Index Page lists every Plugin in the Registry', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const answer = await host.fetch('/');
  const page = await answer.text();

  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^text\/html/);
  for (const name of ['both', 'page-only', 'server-only']) {
    assert.ok(page.includes(name), `the Index Page names ${name}`);
  }
});

test('a Plugin with a Plugin Page is linked, and one without is still listed', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('href="/p/both/"'), 'a Plugin Page is one click away');
  assert.ok(!page.includes('href="/p/server-only/"'), 'a Plugin with no page is not linked');
  assert.ok(page.includes('server-only'), 'a Plugin with no page is still listed');
});

test('an empty Registry says where the Registry is', async (t) => {
  const host = await bootHost(t, []);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('No Plugins are registered'), 'the empty state is plain');
  assert.ok(page.includes(`${host.home}/registry.json`), 'it names the Registry file');
});
