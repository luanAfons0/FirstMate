/** A Plugin Page calls its own Plugin's tools, and so does a terminal. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, type Booted } from './helpers/host.ts';

const EVERY_FIXTURE = [
  { name: 'both', directory: 'both' },
  { name: 'page-only', directory: 'page-only' },
  { name: 'server-only', directory: 'server-only' },
  { name: 'quitter', directory: 'quitter' },
];

/** One tool call, as a Plugin Page makes it: from its own page, same-origin. */
function ask(host: Booted, name: string, call: unknown, from = name): Promise<Response> {
  return host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${from}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(call),
  });
}

test('a tool call reaches the Plugin Server and comes back with its answer', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await ask(host, 'both', {
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: { name: 'echo', arguments: { text: 'hello' } },
  });
  const said = (await answer.json()) as {
    id: number;
    result: { content: { text: string }[] };
  };

  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(said.result.content[0]?.text, 'both says hello');
  assert.equal(said.id, 41, 'the caller gets its own JSON-RPC id back');
});

test('the tools a Plugin Server lists are the tools it lists', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await ask(host, 'server-only', { jsonrpc: '2.0', id: 'a', method: 'tools/list' });
  const said = (await answer.json()) as { id: string; result: { tools: { name: string }[] } };

  assert.equal(said.id, 'a', 'a string id is a JSON-RPC id too');
  assert.deepEqual(
    said.result.tools.map((tool) => tool.name),
    ['ping'],
  );
});

test('two calls on one connection do not see each other', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answers = await Promise.all([
    ask(host, 'both', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'one' } } }),
    ask(host, 'both', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'two' } } }),
  ]);
  const said = (await Promise.all(answers.map((answer) => answer.json()))) as {
    id: number;
    result: { content: { text: string }[] };
  }[];

  assert.equal(said.find((one) => one.id === 1)?.result.content[0]?.text, 'both says one');
  assert.equal(said.find((one) => one.id === 2)?.result.content[0]?.text, 'both says two');
});

test('a Plugin Page may reach only its own Plugin', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await ask(host, 'server-only', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'both');

  assert.equal(answer.status, 403);
  assert.match(await answer.text(), /Only the Plugin Page of server-only/);
});

test('a Plugin that ships no Plugin Server is refused clearly', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await ask(host, 'page-only', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const said = (await answer.json()) as { error: { message: string } };

  assert.equal(answer.status, 501);
  assert.match(said.error.message, /ships no Plugin Server/);
});

test('a Stopped Plugin is refused clearly', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await ask(host, 'quitter', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const said = (await answer.json()) as { error: { message: string } };

  assert.equal(answer.status, 503);
  assert.match(said.error.message, /is Stopped/);
});

test('an unknown Plugin is not found, and a body that is not JSON-RPC is refused', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const stranger = await ask(host, 'nobody', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(stranger.status, 404);

  const rubbish = await host.fetch('/p/both/rpc', {
    method: 'POST',
    headers: { origin: host.origin, referer: `${host.origin}/p/both/` },
    body: 'not json at all',
  });
  const said = (await rubbish.json()) as { error: { code: number } };
  assert.equal(rubbish.status, 400);
  assert.equal(said.error.code, -32700, 'JSON-RPC calls this a parse error');
});

test('every security check applies to a tool call', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);
  const call = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  const stranger = await host.raw({ method: 'POST', path: '/p/both/rpc', body: call, anonymous: true });
  assert.equal(stranger.status, 403, 'no token');

  const foreign = await host.raw({
    method: 'POST',
    path: '/p/both/rpc',
    body: call,
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403, 'another origin');

  const rebound = await host.raw({
    method: 'POST',
    path: '/p/both/rpc',
    body: call,
    headers: { host: 'firstmate.example' },
  });
  assert.equal(rebound.status, 403, 'another Host header');

  const started = await host.raw({
    method: 'POST',
    path: '/p/both/rpc',
    body: call,
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(started.status, 403, 'another site started it');
});

test('a terminal carrying the token gets a real tool result', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  // What `curl -X POST -d ... "…/p/both/rpc?token=…"` sends: no Referer, no
  // Origin, no Sec-Fetch headers, and the token on the query string.
  const answer = await host.raw({
    method: 'POST',
    path: `/p/both/rpc?token=${host.token}`,
    anonymous: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'from a terminal' } },
    }),
  });

  assert.equal(answer.status, 200);
  assert.match(answer.body, /both says from a terminal/);
});

test('a tool call is a POST', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await host.fetch('/p/both/rpc');

  assert.equal(answer.status, 405);
  assert.equal(answer.headers.get('allow'), 'POST');
});

test("a Plugin Page's own call keeps its thirty seconds, whatever it asks for", async (t) => {
  // A ceiling low enough to cut this call short, were the ceiling its own.
  const host = await bootHost(t, [{ name: 'slow', directory: 'slow' }], {
    FIRSTMATE_MAX_CALL_MS: '100',
  });

  const answer = await ask(host, 'slow', {
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'answer-late', arguments: { ms: 400 }, timeoutMs: 1 },
  });
  const said = (await answer.json()) as { result: { content: { text: string }[] } };

  // Neither the ceiling nor the number in the body moved this call: only the
  // Tool Bus takes a `timeoutMs`, because nothing is waiting on a Tool Bus
  // call and a browser is waiting on this one.
  assert.equal(answer.status, 200);
  assert.equal(said.result.content[0]?.text, 'slow answered after 400 ms');
});
