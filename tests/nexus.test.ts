/**
 * The first real Plugin: nexus, served from where it already lives.
 *
 * This is the one test that leaves the fixtures, because a fixture cannot
 * prove the thing #11 asks about — that a page written for another server
 * loads unchanged. It reads ~/.nexus and never writes a byte of it, and it
 * skips itself where that directory is not there, so the suite still runs on
 * a machine that has no nexus.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';

const NEXUS = join(homedir(), '.nexus');

async function isThere(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Every relative asset the page asks for, read out of the page itself. */
function assetsOf(page: string): string[] {
  const found = new Set<string>();
  for (const [, path] of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (path === undefined) continue;
    // A data: URI is already in the page, and an absolute one is not ours.
    if (/^(?:data:|https?:|\/\/|#|\/)/.test(path)) continue;
    found.add(path);
  }
  return [...found];
}

test('the Host serves nexus as a Plugin Page, byte for byte', async (t) => {
  if (!(await isThere(join(NEXUS, 'web', 'index.html')))) {
    t.skip('this machine has no ~/.nexus to prove anything against');
    return;
  }
  const host = await bootHost(t, [{ name: 'nexus', directory: NEXUS }]);

  const answer = await host.fetch('/p/nexus/');
  const served = Buffer.from(await answer.arrayBuffer());
  const onDisk = await readFile(join(NEXUS, 'web', 'index.html'));

  assert.equal(answer.status, 200);
  assert.deepEqual(served, onDisk, 'the page is nexus\'s own bytes');

  const assets = assetsOf(onDisk.toString('utf8'));
  assert.ok(assets.length > 0, 'the page asks for something');
  for (const asset of assets) {
    // The path is used exactly as the page wrote it: nothing was rewritten.
    const got = await host.fetch(`/p/nexus/${asset}`);
    const bytes = Buffer.from(await got.arrayBuffer());
    assert.equal(got.status, 200, asset);
    assert.deepEqual(bytes, await readFile(join(NEXUS, 'web', asset)), asset);
  }
});

test('nexus appears on the Index Page in whatever state it is in', async (t) => {
  if (!(await isThere(join(NEXUS, 'web', 'index.html')))) {
    t.skip('this machine has no ~/.nexus to prove anything against');
    return;
  }
  const host = await bootHost(t, [{ name: 'nexus', directory: NEXUS }]);

  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('href="/p/nexus/"'), 'it is one click away');

  // Which state is right depends on the nexus repository, not on this one,
  // so this asks the same question the Host asked and expects the same
  // answer. Asserting one state here would tie a green suite to the contents
  // of another repository.
  const shipsServer = await isThere(join(NEXUS, 'mcp'));
  assert.ok(
    page.includes(shipsServer ? 'Running' : 'no Plugin Server'),
    shipsServer ? 'it ships an mcp, so it runs' : 'it ships no mcp yet',
  );
});

test('nexus answers its own tools, once it ships a Plugin Server', async (t) => {
  if (!(await isThere(join(NEXUS, 'mcp')))) {
    t.skip('this nexus ships no Plugin Server yet');
    return;
  }
  const host = await bootHost(t, [{ name: 'nexus', directory: NEXUS }]);

  const answer = await host.fetch('/p/nexus/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: `${host.origin}/p/nexus/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const said = (await answer.json()) as { result: { tools: { name: string }[] } };

  assert.equal(answer.status, 200);
  assert.ok(said.result.tools.length > 0, 'a real Plugin answers with real tools');
});
