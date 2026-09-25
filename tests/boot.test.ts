/** The Host boots: it listens where it says it does, and only there. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import test from 'node:test';
import { bootHost, firstmate, makeHome } from './helpers/host.ts';

test('the runtime file holds the port actually listened on and the token', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const runtime = JSON.parse(await readFile(join(host.home, 'runtime.json'), 'utf8')) as {
    port: number;
    token: string;
  };

  assert.equal(runtime.port, host.port);
  assert.match(runtime.token, /^[0-9a-f]{64}$/);

  const answer = await host.fetch('/');
  assert.equal(answer.status, 200);
});

test('a second start rewrites the runtime file', async (t) => {
  const first = await bootHost(t, []);
  const before = await readFile(join(first.home, 'runtime.json'), 'utf8');

  const second = await bootHost(t, []);
  const after = await readFile(join(second.home, 'runtime.json'), 'utf8');

  assert.notEqual(before, after);
});

test('the Host is reachable from this machine and from nowhere else', async (t) => {
  const host = await bootHost(t, []);
  const elsewhere = ownAddress();
  if (elsewhere === null) {
    t.skip('this machine has no address other than loopback');
    return;
  }

  await assert.rejects(reach(elsewhere, host.port), /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/);
});

test('a ceiling on a call that is not a number stops the Host with a sentence', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['start'], { FIRSTMATE_MAX_CALL_MS: 'ten minutes' });

  // The same sentence, and the same refusal to start at all, that a handshake
  // which is not a number of milliseconds gets.
  assert.equal(said.code, 1);
  assert.match(
    said.stderr,
    /FIRSTMATE_MAX_CALL_MS must be a whole number of milliseconds above zero, not "ten minutes"\./,
  );
});

test('a ceiling longer than a timer can hold stops the Host with a sentence', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['start'], { FIRSTMATE_MAX_CALL_MS: '3000000000' });

  // Node would fire a timer this long after one millisecond, so every call
  // would be cut short at once. Better to refuse the setting than to obey it.
  assert.equal(said.code, 1);
  assert.match(said.stderr, /FIRSTMATE_MAX_CALL_MS may be 2147483647 milliseconds at most/);
});

function ownAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

function reach(address: string, port: number): Promise<void> {
  return new Promise((done, fail) => {
    const socket = connect({ host: address, port, timeout: 2000 });
    socket.once('connect', () => {
      socket.destroy();
      done();
    });
    socket.once('timeout', () => {
      socket.destroy();
      fail(new Error('ETIMEDOUT'));
    });
    socket.once('error', fail);
  });
}
