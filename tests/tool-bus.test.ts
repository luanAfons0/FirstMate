/**
 * The Tool Bus: one Plugin calls another Plugin's tools, and only under a
 * Grant. A caller may say how long its call is allowed to take, under the
 * Host's own ceiling. Every refusal is a sentence, and the Host keeps no
 * record of any of it (ADR-0005).
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { bootHost, type Booted } from './helpers/host.ts';

type Said = {
  readonly id: unknown;
  readonly result?: { content?: { text: string }[]; tools?: { name: string }[] };
  readonly error?: { message: string };
};

/** One tool call, as a Plugin Page makes it: from its own page, same-origin. */
async function ask(host: Booted, name: string, tool: string, given: unknown): Promise<Said> {
  const answer = await host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${name}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: tool, arguments: given },
    }),
  });
  assert.equal(answer.status, 200);
  return (await answer.json()) as Said;
}

test("a Plugin with a Grant reaches the other Plugin's tools", async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['server-only'] },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const said = await ask(host, 'asker', 'reach', { plugin: 'server-only', tool: 'ping' });

  // The target Plugin's own answer, with nothing of the Host's around it.
  assert.equal(said.error, undefined);
  assert.equal(said.result?.content?.[0]?.text, 'pong from server-only');
});

test("a Plugin with a Grant can list the other Plugin's tools", async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['server-only'] },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const said = await ask(host, 'asker', 'catalogue', { plugin: 'server-only' });

  assert.deepEqual(said.result?.tools?.map((tool) => tool.name), ['ping']);
});

test('a Plugin with no Grant is refused, and the answer names both Plugins', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller' },
    { name: 'server-only', directory: 'server-only' },
  ]);

  const said = await ask(host, 'asker', 'reach', { plugin: 'server-only', tool: 'ping' });

  assert.equal(
    said.error?.message,
    'The Plugin named asker holds no Grant to call the Plugin named server-only.',
  );
});

test('a Grant is one way, so the Plugin on the other end of it is still refused', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['answerer'] },
    { name: 'answerer', directory: 'caller' },
  ]);

  const forwards = await ask(host, 'asker', 'catalogue', { plugin: 'answerer' });
  const backwards = await ask(host, 'answerer', 'catalogue', { plugin: 'asker' });

  assert.equal(forwards.error, undefined, 'the Grant it holds is carried');
  assert.match(
    backwards.error?.message ?? '',
    /answerer holds no Grant to call the Plugin named asker/,
  );
});

test('a Plugin with no Grant to itself may not call itself', async (t) => {
  const host = await bootHost(t, [{ name: 'lonely', directory: 'caller' }]);

  const said = await ask(host, 'lonely', 'catalogue', { plugin: 'lonely' });

  // One rule and no exception to remember: a Plugin that wants to call itself
  // grants itself.
  assert.equal(
    said.error?.message,
    'The Plugin named lonely holds no Grant to call the Plugin named lonely.',
  );
});

test('a Grant to a Stopped Plugin says Stopped, not refused', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['quitter'] },
    { name: 'quitter', directory: 'quitter' },
  ]);

  const said = await ask(host, 'asker', 'catalogue', { plugin: 'quitter' });

  // Stopped is a thing to go and fix. A missing Grant is a thing to ask the
  // operator for. A Plugin author must be able to tell them apart.
  assert.equal(said.error?.message, 'The Plugin named quitter is Stopped.');
});

test('a Grant to a Plugin that ships no Plugin Server says so', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['page-only'] },
    { name: 'page-only', directory: 'page-only' },
  ]);

  const said = await ask(host, 'asker', 'catalogue', { plugin: 'page-only' });

  assert.equal(said.error?.message, 'The Plugin named page-only ships no Plugin Server.');
});

test('a Grant to a Plugin Name that is not registered says so', async (t) => {
  const host = await bootHost(t, [{ name: 'asker', directory: 'caller', grants: ['ghost'] }]);

  const said = await ask(host, 'asker', 'catalogue', { plugin: 'ghost' });

  assert.equal(said.error?.message, 'No Plugin named ghost is in the Registry.');
});

test('two Plugins granted to each other do not call each other for ever', async (t) => {
  const host = await bootHost(t, [
    { name: 'ping-pong-one', directory: 'caller', grants: ['ping-pong-two'] },
    { name: 'ping-pong-two', directory: 'caller', grants: ['ping-pong-one'] },
  ]);

  const said = await ask(host, 'ping-pong-one', 'bounce', {
    there: 'ping-pong-two',
    back: 'ping-pong-one',
  });

  // It fails loudly and early rather than spinning, and names the chain, so
  // that the operator can see which pair of Grants made the cycle.
  assert.match(said.error?.message ?? '', /^A call may pass through 8 Plugins\./);
  assert.match(said.error?.message ?? '', /ping-pong-one, ping-pong-two/);
});

/** The pair of Plugins every test about how long a call may take is run with. */
const SLOW_PAIR = [
  { name: 'asker', directory: 'caller', grants: ['slow'] },
  { name: 'slow', directory: 'slow' },
];

/** Wait until the Host's output says this, so that no test guesses at a delay. */
async function until(host: Booted, said: RegExp): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!said.test(host.output())) {
    if (Date.now() > deadline) {
      throw new Error(`The Host never said ${String(said)}.\n${host.output()}`);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
}

test('a call that asks for a longer wait than it needs is answered, not cut short', async (t) => {
  const host = await bootHost(t, SLOW_PAIR);

  const said = await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'answer-late',
    arguments: { ms: 200 },
    timeoutMs: 9_000,
  });

  assert.equal(said.error, undefined);
  assert.equal(said.result?.content?.[0]?.text, 'slow answered after 200 ms');
});

test('a call that asks for a shorter wait is given that one and no other', async (t) => {
  const host = await bootHost(t, SLOW_PAIR);

  const said = await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'answer-late',
    arguments: { ms: 5_000 },
    timeoutMs: 300,
  });

  // Three hundred milliseconds, and not the thirty seconds a call that asks
  // for nothing still gets: the number in the sentence is the number it asked
  // for.
  assert.equal(said.error?.message, 'The Plugin Server of slow did not answer in 300 ms.');
});

test('a call that asks for longer than the ceiling gets the ceiling', async (t) => {
  const host = await bootHost(t, SLOW_PAIR, { FIRSTMATE_MAX_CALL_MS: '250' });

  const began = Date.now();
  const said = await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'answer-late',
    arguments: { ms: 5_000 },
    timeoutMs: 60_000,
  });

  // Silently: what comes back is the Host's ordinary sentence with the ceiling
  // in it, never a refusal for asking too much. A Plugin does not have to know
  // the Host's number to be allowed to run.
  assert.equal(said.error?.message, 'The Plugin Server of slow did not answer in 250 ms.');
  assert.ok(Date.now() - began < 4_000, 'it waited the ceiling, not what it asked for');
});

test('a call whose timeoutMs is not a number is refused with a sentence', async (t) => {
  const host = await bootHost(t, SLOW_PAIR);

  const said = await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'now',
    timeoutMs: 'in a while',
  });

  assert.equal(
    said.error?.message,
    'The "timeoutMs" of a firstmate/tools/call must be a whole number of milliseconds ' +
      'above zero, not "in a while".',
  );
});

test('a call that runs out of time leaves the Plugin Server running', async (t) => {
  const host = await bootHost(t, SLOW_PAIR);

  const gaveUp = await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'answer-late',
    arguments: { ms: 600 },
    timeoutMs: 150,
  });
  assert.equal(gaveUp.error?.message, 'The Plugin Server of slow did not answer in 150 ms.');

  const listed = (await (await host.fetch('/plugins.json')).json()) as {
    plugins: { name: string; state: string }[];
  };

  // The Host cancels nothing when it gives up. The target is working still,
  // and a caller that reads a timeout as "it did not happen" would be wrong.
  assert.equal(listed.plugins.find((plugin) => plugin.name === 'slow')?.state, 'running');
});

test('a late answer nobody is owed is dropped, and the pipe stays clear', async (t) => {
  const host = await bootHost(t, SLOW_PAIR);

  await ask(host, 'asker', 'reach', {
    plugin: 'slow',
    tool: 'answer-late',
    arguments: { ms: 600 },
    timeoutMs: 150,
  });
  // The answer nobody is owed is written on the same pipe every other call
  // uses. Wait for it rather than guess at it.
  await until(host, /slow: answered after 600 ms/);

  const said = await ask(host, 'asker', 'reach', { plugin: 'slow', tool: 'now' });

  assert.equal(said.error, undefined, 'the connection carried the next call');
  assert.equal(
    said.result?.content?.[0]?.text,
    'slow answered at once',
    'and nobody was handed somebody else\'s answer',
  );
});

test('a Plugin Page still may not reach another Plugin through the Tool Bus', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['server-only'] },
    { name: 'server-only', directory: 'server-only' },
  ]);

  // The Tool Bus is on the pipe the Host owns, and a browser holds no end of
  // it. This body reaches the Plugin Server of asker, which is not the Host.
  const answer = await host.fetch('/p/asker/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/asker/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'firstmate/tools/call',
      params: { plugin: 'server-only', name: 'ping' },
    }),
  });
  const said = (await answer.json()) as Said;

  assert.match(said.error?.message ?? '', /no such method: firstmate\/tools\/call/);
});

test('the Host keeps no record of a call it carried', async (t) => {
  const host = await bootHost(t, [
    { name: 'asker', directory: 'caller', grants: ['server-only'] },
    { name: 'server-only', directory: 'server-only' },
  ]);

  await ask(host, 'asker', 'reach', { plugin: 'server-only', tool: 'ping' });
  const home = (await readdir(host.home)).sort();

  // No run history, no log of what was called, no cached result (ADR-0005).
  assert.deepEqual(home, ['registry.json', 'runtime.json']);
});
