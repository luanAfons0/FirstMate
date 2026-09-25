/**
 * The requests and starts that go wrong: a tool call too large to read, a
 * Plugin Page file the Host cannot read, and a port another process holds.
 * None of them may take the Host down, or leave it half up.
 */
import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, makeHome } from './helpers/host.ts';

test('a tool call too large to read is answered 413, and the Host keeps serving', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const answer = await host.fetch('/p/both/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"jsonrpc":"2.0","id":1,"method":"tools/list","pad":"${'x'.repeat(2_000_000)}"}`,
  });
  const said = (await answer.json()) as { error: { message: string } };

  assert.equal(answer.status, 413);
  assert.match(said.error.message, /may not be larger than/);
  assert.equal((await host.fetch('/')).status, 200);
});

test('a Plugin Page file the Host cannot read is not found, and nothing else breaks', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads every file, so no file here is unreadable');
    return;
  }
  const plugin = await makeHome(t);
  await mkdir(join(plugin, 'web'));
  await writeFile(join(plugin, 'web', 'index.html'), '<p>here</p>\n');
  await writeFile(join(plugin, 'web', 'locked.txt'), 'nobody reads this\n');
  await chmod(join(plugin, 'web', 'locked.txt'), 0o000);
  const host = await bootHost(t, [{ name: 'locked', directory: plugin }]);

  const locked = await host.fetch('/p/locked/locked.txt');

  assert.equal(locked.status, 404);
  assert.equal((await host.fetch('/p/locked/')).status, 200);
});

test('a Host whose port is taken exits rather than hold its Plugin Servers', async (t) => {
  const taken = createServer();
  await new Promise<void>((done) => taken.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => taken.close(() => done())));
  const address = taken.address();
  assert.ok(address !== null && typeof address !== 'string');

  await assert.rejects(
    bootHost(t, [{ name: 'server-only', directory: 'server-only' }], {
      FIRSTMATE_PORT: String(address.port),
    }),
    /exited before it listened[\s\S]*EADDRINUSE/,
  );
});
