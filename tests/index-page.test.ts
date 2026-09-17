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

test('a linked Plugin is written as the address it leads to', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('<i>/p/</i><b>both</b><i>/</i>'), 'the row reads as the address');
});

test('a Plugin with no Plugin Page is given no address', async (t) => {
  const host = await bootHost(t, [{ name: 'server-only', directory: 'server-only' }]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('<b>server-only</b>'), 'it is named');
  assert.ok(!page.includes('/p/server-only/'), 'it is given no path at all');
});

test('the Index Page counts the Plugins and how many are Running', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
  ]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('2 Plugins · 1 Running'), 'the header counts both');
});

test('a short list is offered no filter, and a long one is', async (t) => {
  const few = await bootHost(
    t,
    [1, 2, 3].map((n) => ({ name: `p${n}`, directory: 'page-only' })),
  );
  assert.ok(!(await (await few.fetch('/')).text()).includes('id="filter"'), 'three need no box');

  const many = await bootHost(
    t,
    [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `p${n}`, directory: 'page-only' })),
  );
  assert.ok((await (await many.fetch('/')).text()).includes('id="filter"'), 'seven do');
});

test('an empty Registry says how to add a Plugin', async (t) => {
  const host = await bootHost(t, []);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('node src/cli.ts add'), 'the empty page is an invitation to act');
});
