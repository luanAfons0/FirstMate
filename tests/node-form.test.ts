/**
 * A Plugin can ship its Plugin Server as `mcp.ts` or `mcp.js`, and the Host
 * runs it with its own Node, the one it names in `FIRSTMATE_NODE`, so a
 * machine with nothing but the App needs no Node of its own (ADR-0028).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, type Booted } from './helpers/host.ts';

async function stateOf(host: Booted, name: string): Promise<string | undefined> {
  const listed = (await (await host.fetch('/plugins.json')).json()) as {
    plugins: { name: string; state: string }[];
  };
  return listed.plugins.find((plugin) => plugin.name === name)?.state;
}

/** What one tool call answers, asked as a Plugin Page asks: from its own page, same-origin. */
async function pong(host: Booted, name: string): Promise<string | undefined> {
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
      id: 1,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    }),
  });
  assert.equal(answer.status, 200, host.output());
  const said = (await answer.json()) as { result: { content: { text: string }[] } };
  return said.result.content[0]?.text;
}

test("a Plugin with only an mcp.ts runs on the Host's own Node, and its tools answer", async (t) => {
  const host = await bootHost(t, [{ name: 'node-form', directory: 'node-form' }]);

  assert.equal(await stateOf(host, 'node-form'), 'running', host.output());
  assert.equal(await pong(host, 'node-form'), 'pong from mcp.ts');
});

test('a Plugin with only an mcp.js runs the same way', async (t) => {
  const host = await bootHost(t, [{ name: 'node-js', directory: 'node-js' }]);

  assert.equal(await stateOf(host, 'node-js'), 'running', host.output());
  assert.equal(await pong(host, 'node-js'), 'pong from mcp.js');
});

test('mcp.ts wins over every other form beside it', async (t) => {
  const host = await bootHost(t, [{ name: 'node-first', directory: 'node-first' }]);

  assert.equal(await stateOf(host, 'node-first'), 'running', host.output());
  assert.equal(await pong(host, 'node-first'), 'pong from mcp.ts', 'not from mcp or mcp.cmd');
});
