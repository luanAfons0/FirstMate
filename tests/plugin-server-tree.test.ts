/**
 * A Plugin Server that will not end is killed, and every process it started
 * goes with it: a restart and a Host stop leave no child of it running.
 *
 * The fixture's Plugin Server starts a child, and both ignore SIGTERM, so
 * only a kill of the whole tree ends the child. Linux alone: on Windows the
 * Host already ends the whole tree with `taskkill /t` (ADR-0019), and this
 * test reads `/proc`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { bootHost, firstmate, until, type Booted } from './helpers/host.ts';

const SKIP =
  process.platform === 'linux'
    ? false
    : 'Linux alone: Windows ends a Plugin Server with taskkill /t, and this test reads /proc';

/** How long the system has to reap a killed child before the test says it lives. */
const REAP_MS = 5_000;

/** Whether a process runs. A zombie has ended, and waits only to be reaped. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
}

/** Whether a process ends within the time the system has to reap it. */
async function ends(pid: number): Promise<boolean> {
  const deadline = Date.now() + REAP_MS;
  while (isRunning(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
  return true;
}

/**
 * The pid of the child the Plugin Server started, said after `from` in the
 * Host's output. A child left running is killed when the test ends, so that
 * a failed test leaves nothing behind.
 */
async function childOf(t: TestContext, host: Booted, from = 0): Promise<number> {
  const said = /stubborn-parent: started a child with pid (\d+)/g;
  said.lastIndex = from;
  await until(host, { exec: (output: string) => said.exec(output) } as RegExp);
  said.lastIndex = from;
  const pid = Number(said.exec(host.output())?.[1]);
  t.after(() => {
    if (isRunning(pid)) process.kill(pid, 'SIGKILL');
  });
  assert.equal(isRunning(pid), true, 'the child runs while its Plugin Server runs');
  return pid;
}

test(
  'a restart leaves no child of a Plugin Server that would not end',
  { skip: SKIP },
  async (t) => {
    const host = await bootHost(t, [{ name: 'stubborn-parent', directory: 'stubborn-parent' }]);
    const child = await childOf(t, host);
    const before = host.output().length;

    const restarted = await firstmate(host.home, ['restart', 'stubborn-parent']);

    assert.equal(restarted.code, 0, restarted.stderr);
    assert.match(host.output(), /stubborn-parent: SIGTERM, and staying/);
    // The restarted Plugin Server's child runs, and is killed should the test fail.
    await childOf(t, host, before);
    assert.equal(await ends(child), true, `the child ${child} outlived the restart`);
  },
);

test(
  'a Host stop leaves no child of a Plugin Server that would not end',
  { skip: SKIP },
  async (t) => {
    const host = await bootHost(t, [{ name: 'stubborn-parent', directory: 'stubborn-parent' }]);
    const child = await childOf(t, host);

    await host.stop();

    assert.match(host.output(), /stubborn-parent: SIGTERM, and staying/);
    assert.equal(await ends(child), true, `the child ${child} outlived the Host`);
  },
);
