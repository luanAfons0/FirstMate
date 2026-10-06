/** The Index Page: every registered Plugin, and a link to each Plugin Page. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
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
  assert.ok(page.includes(join(host.home, 'registry.json')), 'it names the Registry file');
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

  assert.ok(page.includes('firstmate add &lt;name&gt; &lt;dir&gt;'), 'it says how to register');
  assert.ok(page.includes('firstmate install research'), 'it says how to fetch an Official Plugin');
  assert.ok(!page.includes('cli.ts'), 'it shows the command a person types, not a path');
});

test('the Index Page carries the dark theme and the light one, and the system chooses', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('color-scheme: light dark'), 'the browser is told both themes exist');
  assert.match(page, /@media \(prefers-color-scheme: light\)/, 'the system picks the theme');
  // The paper of the approved look, dark and then light: one set for every page.
  assert.ok(page.includes('--bg: #17181a'), 'the dark paper is the one the App shows');
  assert.ok(page.includes('--bg: #f8f8f7'), 'the light paper is the one the App shows');
});

test('the Index Page loads nothing from outside itself', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const page = await (await host.fetch('/')).text();

  for (const outside of ['<link', ' src=', '@import', 'url(', '//']) {
    assert.ok(!page.includes(outside), `the page carries no ${outside}`);
  }
});

test('the Index Page heading says Plugins, and its title stays FirstMate', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('<h1>Plugins</h1>'), 'the heading names the list');
  assert.ok(page.includes('<title>FirstMate</title>'), 'the title is the App');
});

test('the count names the Stopped Plugins, and only when there are some', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('2 Plugins · 1 Running · <span class="stopped">1 Stopped</span>'), page);

  const calm = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  assert.ok(!(await (await calm.fetch('/')).text()).includes('Stopped</span>'), 'none Stopped');
});

test('a Stopped row gives the command that starts its Plugin Server again', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
  ]);

  const page = await (await host.fetch('/')).text();

  assert.ok(page.includes('<code>firstmate restart quitter</code>'), 'the Stopped row says it');
  assert.ok(!page.includes('firstmate restart both'), 'a Running row does not');
});

test('the Index Page keeps no form and no Shelf line', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const page = await (await host.fetch('/')).text();

  assert.ok(!page.includes('<form'), 'no form');
  assert.ok(!page.includes('<button'), 'no button');
  assert.ok(!page.includes('Shelf') && !page.includes('shelf'), 'no word of the Shelf');
});
