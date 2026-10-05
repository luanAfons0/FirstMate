/**
 * The built Host is the Host.
 *
 * Every other test drives the source. The package holds a bundle of it
 * (ADR-0017), so this one drives the bundle through the same helper, with the
 * same requests, and asks for the same answers.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, build, fixture, type Booted } from './helpers/host.ts';

/** One tool call, as a Plugin Page makes it: from its own page, same-origin. */
function ask(host: Booted, name: string, call: unknown): Promise<Response> {
  return host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${name}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(call),
  });
}

test('the built Host serves the Index Page, a Plugin Page and a tool call', async (t) => {
  const host = await bootHost(
    t,
    [{ name: 'both', directory: 'both' }],
    {},
    { built: await build(t) },
  );

  const index = await host.fetch('/');
  assert.equal(index.status, 200);
  assert.ok((await index.text()).includes('/p/both/'), 'the Index Page lists the Plugin');

  const page = await host.fetch('/p/both/');
  assert.equal(page.status, 200);
  assert.equal(
    await page.text(),
    await readFile(join(fixture('both'), 'web', 'index.html'), 'utf8'),
  );

  const answer = await ask(host, 'both', {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'echo', arguments: { text: 'hello' } },
  });
  const said = (await answer.json()) as { result: { content: { text: string }[] } };
  assert.equal(answer.status, 200);
  assert.equal(said.result.content[0]?.text, 'both says hello');
});

test('the built command line starts the same Host', async (t) => {
  const host = await bootHost(
    t,
    [{ name: 'both', directory: 'both' }],
    {},
    { built: await build(t), viaCommandLine: true },
  );

  const plugins = await host.fetch('/plugins.json');
  assert.equal(plugins.status, 200);
  assert.match(await plugins.text(), /"both"/);
});
