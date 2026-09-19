/**
 * The pipe between the Host and a Plugin Server is two-way: a Plugin Server
 * can ask the Host for something on its own account and is answered on its own
 * stdin, with the id it gave and never a number of the Host's own.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, type Booted } from './helpers/host.ts';

const SPEAKER = [{ name: 'speaker', directory: 'speaker' }];

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

/**
 * Wait for a line in the Host's output. A Plugin Server's stderr arrives when
 * the Plugin Server writes it, which is not when the Host answered a request.
 */
async function until(host: Booted, pattern: RegExp): Promise<RegExpExecArray> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = pattern.exec(host.output());
    if (found !== null) return found;
    assert.ok(Date.now() < deadline, `the Host never said ${pattern}\n${host.output()}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

test('a Plugin Server that asks the Host is answered on its own stdin', async (t) => {
  const host = await bootHost(t, SPEAKER);

  const said = await until(host, /speaker: asked with id 99, answered id (\S+):/);

  assert.equal(said[1], '99', 'the answer carries the id the Plugin Server gave');
});

test('a method the Host does not carry comes back as a sentence, not silence', async (t) => {
  const host = await bootHost(t, SPEAKER);

  const said = await until(host, /speaker: asked with id 99, answered id 99: (.+)/);

  assert.equal(
    said[1],
    'The Host carries no method named firstmate/nothing.',
    'a refusal is a sentence the Plugin author can act on',
  );
});

test('the Host declares in the handshake that it answers a Plugin Server', async (t) => {
  const host = await bootHost(t, SPEAKER);

  const said = await until(host, /speaker: the Host offers (.+)/);
  const offered = JSON.parse(said[1] ?? '{}') as { experimental?: { firstmate?: unknown } };

  assert.notEqual(
    offered.experimental?.firstmate,
    undefined,
    'a Plugin Server can tell what this Host carries before it tries',
  );
});

test("a Plugin Server's own request number is never read as an answer", async (t) => {
  const host = await bootHost(t, SPEAKER);

  // The fixture asks the Host using the very number the Host renumbered this
  // call to, while the Host is still waiting on it. Read as an answer, that
  // question would come back here in place of the Plugin Server's result.
  const answer = await ask(host, 'speaker', {
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: { name: 'speak-back', arguments: {} },
  });
  const said = (await answer.json()) as {
    id: number;
    method?: string;
    result?: { content: { text: string }[] };
  };

  assert.equal(answer.status, 200);
  assert.equal(said.method, undefined, 'a question is never handed back as an answer');
  assert.equal(said.result?.content[0]?.text, 'speaker asked and was answered');
  assert.equal(said.id, 41, 'and the Plugin Page still gets its own id back');

  // And the collision really happened: the number it asked with is the number
  // the Host was waiting on, and it was answered under that same number.
  const waiting = await until(host, /speaker: the Host is waiting on id (\d+)/);
  await until(host, new RegExp(`speaker: asked with id ${waiting[1]}, answered id ${waiting[1]}:`));
});

test('a notification a Plugin Server sends up is still dropped, and still harmless', async (t) => {
  const host = await bootHost(t, SPEAKER);

  // The fixture sends it before it answers the handshake. A notification has no
  // answer to wait for, so the Host drops it and the Plugin Server runs on.
  const page = await (await host.fetch('/')).text();

  assert.match(page, /speaker/, 'the Index Page has a row for it');
  assert.doesNotMatch(host.output(), /wrote a line that is not JSON/, 'nothing was broken');
  await until(host, /speaker: asked with id 99, answered id 99:/);
});
