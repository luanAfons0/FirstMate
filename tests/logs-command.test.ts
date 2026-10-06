/**
 * The Host's log: one file in the home directory, holding what the Host and
 * every Plugin Server said, never past its cap, and never the token.
 * `firstmate logs` prints it, and `logs -f` follows it (ADR-0022).
 */
import assert from 'node:assert/strict';
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, firstmate, firstmateRunning, makeHome, until } from './helpers/host.ts';

/** The cap one log file keeps under. */
const CAP = 2 * 1024 * 1024;

test("a Plugin Server's stderr is in the log, and logs prints it", async (t) => {
  const host = await bootHost(t, [{ name: 'server-only', directory: 'server-only' }]);
  await until(host, /the Plugin Server of server-only is running/);

  const printed = await firstmate(host.home, ['logs']);

  assert.equal(printed.code, 0, printed.stderr);
  assert.match(printed.stdout, /server-only: the Plugin Server is up/);
  assert.match(printed.stdout, /FirstMate: the Plugin Server of server-only is running\./);
});

test(
  'every line a Plugin Server wrote before the Host stopped is in the log',
  {
    skip:
      process.platform === 'win32' &&
      'Windows has no signal that asks the Host to end: a test can only kill it at once',
  },
  async (t) => {
    const lines = 2_000;
    const host = await bootHost(t, [{ name: 'farewell', directory: 'farewell' }], {
      FAREWELL_LINES: String(lines),
    });
    await until(host, /farewell: the Plugin Server is up/);

    await host.stop();

    const log = await readFile(join(host.home, 'firstmate.log'), 'utf8');
    for (let at = 1; at <= lines; at += 1) {
      assert.ok(log.includes(`farewell: line ${at}\n`), `line ${at} is in the log`);
    }
    assert.match(log, /farewell: gone\n/);
  },
);

test('the token never reaches the log', async (t) => {
  const host = await bootHost(t, [{ name: 'server-only', directory: 'server-only' }]);
  await until(host, /the Plugin Server of server-only is running/);

  const log = await readFile(join(host.home, 'firstmate.log'), 'utf8');

  assert.ok(log.length > 0, 'the log was written');
  assert.ok(!log.includes(host.token), 'and the token is not in it');
});

test('the log never grows past its cap, and keeps the older half', async (t) => {
  const host = await bootHost(t, [{ name: 'chatter', directory: 'chatter' }], {
    CHATTER_BYTES: String(5 * 1024 * 1024),
  });
  await until(host, /chatter: done/, 30_000);

  const log = await stat(join(host.home, 'firstmate.log'));
  const old = await stat(join(host.home, 'firstmate.log.old'));

  assert.ok(log.size <= CAP, `the log is ${log.size} bytes`);
  assert.ok(old.size <= CAP, `the older log is ${old.size} bytes`);
  const printed = await firstmate(host.home, ['logs']);
  assert.match(printed.stdout, /chatter: done\n/, 'the newest line is kept');
});

test('logs -f keeps printing new lines until it is stopped', async (t) => {
  const home = await makeHome(t);
  await writeFile(join(home, 'firstmate.log'), 'FirstMate: the first line\n');

  const following = firstmateRunning(t, home, ['logs', '-f']);
  await waitFor(() => following.output().includes('the first line'));
  await appendFile(join(home, 'firstmate.log'), 'FirstMate: a later line\n');

  await waitFor(() => following.output().includes('a later line'));
  assert.equal(following.output(), 'FirstMate: the first line\nFirstMate: a later line\n');
});

test('with no log yet, logs says where it will be', async (t) => {
  const home = await makeHome(t);

  const printed = await firstmate(home, ['logs']);

  assert.equal(printed.code, 4);
  assert.equal(
    printed.stderr,
    `firstmate: there is no log yet, at ${join(home, 'firstmate.log')}.\n`,
  );
});

/** Wait until this is true, or fail after a few seconds. */
async function waitFor(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('waited five seconds, and it never came');
    await new Promise((later) => setTimeout(later, 20));
  }
}
