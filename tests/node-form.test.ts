/**
 * A Plugin can ship its Plugin Server as `mcp.ts` or `mcp.js`, and the Host
 * runs it with its own Node, the one it names in `FIRSTMATE_NODE`, so a
 * machine with nothing but the App needs no Node of its own (ADR-0028).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';
import { callTool, stateOf } from './helpers/plugins.ts';

test("a Plugin with only an mcp.ts runs on the Host's own Node, and its tools answer", async (t) => {
  const host = await bootHost(t, [{ name: 'node-form', directory: 'node-form' }]);

  assert.equal(await stateOf(host, 'node-form'), 'running', host.output());
  assert.deepEqual(await callTool(host, 'node-form', 'ping'), {
    status: 200,
    text: 'pong from mcp.ts',
  });
});

test('a Plugin with only an mcp.js runs the same way', async (t) => {
  const host = await bootHost(t, [{ name: 'node-js', directory: 'node-js' }]);

  assert.equal(await stateOf(host, 'node-js'), 'running', host.output());
  assert.deepEqual(await callTool(host, 'node-js', 'ping'), {
    status: 200,
    text: 'pong from mcp.js',
  });
});

test('mcp.ts wins over every other form beside it', async (t) => {
  const host = await bootHost(t, [{ name: 'node-first', directory: 'node-first' }]);

  assert.equal(await stateOf(host, 'node-first'), 'running', host.output());
  assert.deepEqual(
    await callTool(host, 'node-first', 'ping'),
    { status: 200, text: 'pong from mcp.ts' },
    'not from mcp or mcp.cmd',
  );
});
