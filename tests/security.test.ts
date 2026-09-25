/**
 * Only my own browser and my own terminal talk to the Host. Everything else is
 * refused.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, cookieFor } from './helpers/host.ts';

const REGISTRY = [{ name: 'both', directory: 'both' }];

/** What a browser sends when the person navigates to the address themselves. */
const FIRST_NAVIGATION = {
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

test('a request whose Host header is not allowed is refused', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const name of ['firstmate.example', 'attacker.test:1234', '127.0.0.1:1']) {
    const answer = await host.raw({ path: '/', headers: { host: name } });
    assert.equal(answer.status, 403, name);
    assert.match(answer.body, /Host header/, name);
  }
});

test('a request from another origin is refused, and so is a null origin', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const origin of ['http://evil.example', 'https://127.0.0.1:4747', 'null']) {
    const answer = await host.raw({ path: '/', headers: { origin } });
    assert.equal(answer.status, 403, origin);
    assert.match(answer.body, /Origin/, origin);
  }
});

test('a request a foreign site started is refused', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const site of ['cross-site', 'same-site']) {
    const answer = await host.raw({ path: '/', headers: { 'sec-fetch-site': site } });
    assert.equal(answer.status, 403, site);
    assert.match(answer.body, /Sec-Fetch-Site/, site);
  }
});

test('a request carrying no token and no cookie is refused', async (t) => {
  const host = await bootHost(t, REGISTRY);

  for (const path of ['/', '/p/both/', '/p/both/app.js']) {
    const answer = await host.raw({ path, anonymous: true });
    assert.equal(answer.status, 403, path);
    assert.match(answer.body, /no token/, path);
  }
});

test('a request carrying the wrong token is refused', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const wrong = 'f'.repeat(host.token.length);
  const query = await host.raw({ path: `/?token=${wrong}`, anonymous: true });
  const cookie = await host.raw({ path: '/', anonymous: true, headers: { cookie: cookieFor(wrong) } });

  assert.equal(query.status, 403);
  assert.equal(cookie.status, 403);
});

test('the first navigation trades the token for a cookie and a clean address', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const answer = await host.raw({
    path: `/p/both/?token=${host.token}`,
    anonymous: true,
    headers: FIRST_NAVIGATION,
  });

  assert.equal(answer.status, 303);
  assert.equal(answer.headers['location'], '/p/both/', 'the address keeps its trailing slash');

  const cookie = answer.headers['set-cookie'] ?? '';
  assert.ok(cookie.startsWith(`firstmate_token=${host.token};`), 'the cookie carries the token');
  assert.match(cookie, /SameSite=Strict/, 'no other site may send it');
  assert.match(cookie, /HttpOnly/, 'no script may read it');
  assert.match(cookie, /Path=\//, 'it covers every address');
  assert.ok(!/Domain=/i.test(cookie), 'it is host-only');
});

test('after that redirect the cookie alone is enough', async (t) => {
  const host = await bootHost(t, REGISTRY);

  const admitted = await host.raw({
    path: `/?token=${host.token}`,
    anonymous: true,
    headers: FIRST_NAVIGATION,
  });
  const cookie = (admitted.headers['set-cookie'] ?? '').split(';')[0] ?? '';

  const page = await host.raw({
    path: '/p/both/',
    anonymous: true,
    headers: { cookie, 'sec-fetch-site': 'same-origin' },
  });
  const asset = await host.raw({
    path: '/p/both/app.js',
    anonymous: true,
    headers: { cookie, 'sec-fetch-site': 'same-origin', origin: host.origin },
  });

  assert.equal(page.status, 200);
  assert.equal(asset.status, 200);
});

test('the person navigating to the address themselves is admitted', async (t) => {
  const host = await bootHost(t, REGISTRY);

  // Sec-Fetch-Site: none means no site started this request: the person did.
  const answer = await host.raw({ path: '/', headers: FIRST_NAVIGATION });

  assert.equal(answer.status, 200);
});

test('curl reaches the Host with the token as a query parameter', async (t) => {
  const host = await bootHost(t, REGISTRY);

  // A terminal sends no Sec-Fetch headers and did not navigate, so it is
  // answered where it asked instead of being sent somewhere with a cookie.
  const answer = await host.raw({ path: `/p/both/?token=${host.token}`, anonymous: true });

  assert.equal(answer.status, 200);
  assert.match(answer.body, /the Plugin Page of both/);
});

/**
 * The Shelf is shown by the Host and moved from a terminal. These three hold
 * that line. Every Plugin Page is served from the Index Page\'s own origin, so
 * a same-origin write would be a write a Plugin Page can make: it carries the
 * cookie, its Origin is genuine, and its Sec-Fetch-Site really is same-origin
 * (ADR-0012). The answer is to have no such address at all.
 */
test('the Index Page carries no way to set the Shelf, filter and all', async (t) => {
  // Enough Plugins for the filter, so this is the whole page and not a
  // stripped-down one. page-only ships no Plugin Server, so none is started.
  const many = Array.from({ length: 8 }, (_, at) => ({
    name: `p${at + 1}`,
    directory: 'page-only',
  }));
  const host = await bootHost(t, many);

  const page = (await (await host.fetch('/')).text()).toLowerCase();

  assert.ok(page.includes('id="filter"'), 'the filter is on the page');
  for (const shape of [
    '<form',
    'method="post"',
    'type="submit"',
    'formaction',
    'fetch(',
    'xmlhttprequest',
    'sendbeacon',
  ]) {
    assert.ok(!page.includes(shape), `the Index Page carries no ${shape}`);
  }
});

test('the Host answers no address that writes the Shelf', async (t) => {
  const host = await bootHost(t, []);

  for (const path of ['/shelf', '/settings', '/settings.json', '/api/shelf']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await host.fetch(path, { method });
      assert.equal(answer.status, 404, `${method} ${path}`);
    }
  }

  await assert.rejects(
    readFile(join(host.home, 'settings.json')),
    'no request wrote the settings file',
  );
});

test('every address but a tool call answers GET and HEAD alone', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const readOnly = [
    '/',
    '/plugins.json',
    '/shortcuts.json',
    '/notices.json',
    '/p/both/',
    '/p/both/index.html',
  ];
  for (const path of readOnly) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await host.fetch(path, { method });
      assert.equal(answer.status, 405, `${method} ${path}`);
      assert.equal(answer.headers.get('allow'), 'GET, HEAD', `${method} ${path}`);
    }
  }

  // The one address that takes a write takes a tool call, and nothing else.
  const rpc = await host.fetch('/p/both/rpc', { method: 'PUT' });
  assert.equal(rpc.status, 405);
  assert.equal(rpc.headers.get('allow'), 'POST');
});
