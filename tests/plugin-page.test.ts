/** A Plugin Page: the Plugin's own bytes, and nothing that leaves its folder. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, fixture } from './helpers/host.ts';

const REGISTRY = [
  { name: 'both', directory: 'both' },
  { name: 'server-only', directory: 'server-only' },
];

test("a Plugin Page is served from the Plugin's web directory", async (t) => {
  const host = await bootHost(t, REGISTRY);

  const answer = await host.fetch('/p/both/');
  const body = Buffer.from(await answer.arrayBuffer());
  const onDisk = await readFile(join(fixture('both'), 'web', 'index.html'));

  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^text\/html/);
  assert.deepEqual(body, onDisk, "the bytes are the Plugin's own, unmodified");
});

test('every asset under the web directory is served with its own type', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const [path, type] of [
    ['/p/both/app.css', /^text\/css/],
    ['/p/both/app.js', /^text\/javascript/],
    ['/p/both/nested/deep.txt', /^text\/plain/],
  ] as const) {
    const answer = await host.fetch(path);
    const body = Buffer.from(await answer.arrayBuffer());
    const onDisk = await readFile(join(fixture('both'), 'web', path.replace('/p/both/', '')));

    assert.equal(answer.status, 200, path);
    assert.match(answer.headers.get('content-type') ?? '', type, path);
    assert.deepEqual(body, onDisk, path);
  }
});

test('a Plugin address without its trailing slash is redirected to one', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const answer = await host.fetch('/p/both');

  assert.equal(answer.status, 308);
  assert.equal(answer.headers.get('location'), '/p/both/');
});

test('so is a directory inside the Plugin Page', async (t) => {
  const host = await bootHost(t, REGISTRY);

  // Without this every relative path inside the page would resolve one
  // directory too high, which is the whole reason the redirect exists.
  const answer = await host.fetch('/p/both/nested');

  assert.equal(answer.status, 308);
  assert.equal(answer.headers.get('location'), '/p/both/nested/');
});

test('a file the Host has no type for is sent as bytes', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const path of ['/p/both/LICENSE', '/p/both/thing.bin']) {
    const answer = await host.fetch(path);

    assert.equal(answer.status, 200, path);
    assert.equal(
      answer.headers.get('content-type'),
      'application/octet-stream',
      `${path}: no extension and an unknown one are both bytes`,
    );
  }
});

test('a Plugin Page is read-only', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const answer = await host.fetch('/p/both/app.js', { method: 'POST' });

  assert.equal(answer.status, 405);
  assert.equal(answer.headers.get('allow'), 'GET, HEAD');
});

test('a request that leaves the web directory does not', async (t) => {
  const host = await bootHost(t, REGISTRY);
  const secret = await readFile(join(fixture('both'), 'private.txt'), 'utf8');

  // `fetch` folds `..` away before it sends, so the plain spelling is written
  // byte for byte and the encoded ones go through the ordinary client.
  const climbed = await host.raw({ path: '/p/both/../private.txt' });
  assert.ok(climbed.status === 403 || climbed.status === 404, 'a climb is refused');
  assert.ok(!climbed.body.includes(secret.trim()), 'nothing outside web/ is sent');

  for (const path of [
    '/p/both/%2e%2e/private.txt',
    '/p/both/nested/%2e%2e/%2e%2e/private.txt',
    '/p/both//../private.txt',
    '/p/both/index.html%00.txt',
  ]) {
    const answer = await host.fetch(path);
    const body = await answer.text();
    assert.ok(answer.status === 403 || answer.status === 404, `${path} is refused`);
    assert.ok(!body.includes(secret.trim()), `${path} sends nothing outside web/`);
  }
});

test('a Plugin that ships no Plugin Page says so, and an unknown Plugin is not found', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const headless = await host.fetch('/p/server-only/');
  assert.equal(headless.status, 404);
  assert.match(await headless.text(), /ships no Plugin Page/);

  const stranger = await host.fetch('/p/nobody/');
  assert.equal(stranger.status, 404);
  assert.match(await stranger.text(), /No Plugin is named nobody/);
});

test('a missing file inside a Plugin Page is not found', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const answer = await host.fetch('/p/both/nothing-here.js');

  assert.equal(answer.status, 404);
});
