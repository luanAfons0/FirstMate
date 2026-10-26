/**
 * When a Plugin Server ends, every process it started ends with it: a
 * restart, a Host stop and a Plugin Server that ends on its own leave no
 * child of it running.
 *
 * Each fixture's Plugin Server starts a child that ignores SIGTERM.
 * `stubborn-parent` ignores SIGTERM too, so it is killed; `parting-parent`
 * ends on SIGTERM and leaves its child behind. Linux alone: on Windows the
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
 * The pid of the child a Plugin Server started, said after `from` in the
 * Host's output. A child left running is killed when the test ends, so that
 * a failed test leaves nothing behind.
 */
async function childOf(t: TestContext, host: Booted, name: string, from = 0): Promise<number> {
  const said = new RegExp(`${name}: started a child with pid (\\d+)`, 'g');
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

/** Each fixture, and what its Plugin Server says when it gets SIGTERM. */
const PARENTS = [
  { name: 'stubborn-parent', onSigterm: /stubborn-parent: SIGTERM, and staying/ },
  { name: 'parting-parent', onSigterm: /parting-parent: SIGTERM, and leaving/ },
] as const;

for (const { name, onSigterm } of PARENTS) {
  test(`a restart leaves no child of ${name}`, { skip: SKIP }, async (t) => {
    const host = await bootHost(t, [{ name, directory: name }]);
    const child = await childOf(t, host, name);
    const before = host.output().length;

    const restarted = await firstmate(host.home, ['restart', name]);

    assert.equal(restarted.code, 0, restarted.stderr);
    assert.match(host.output(), onSigterm);
    // The restarted Plugin Server's child runs, and is killed should the test fail.
    await childOf(t, host, name, before);
    assert.equal(await ends(child), true, `the child ${child} outlived the restart`);
  });

  test(`a Host stop leaves no child of ${name}`, { skip: SKIP }, async (t) => {
    const host = await bootHost(t, [{ name, directory: name }]);
    const child = await childOf(t, host, name);

    await host.stop();

    assert.match(host.output(), onSigterm);
    assert.equal(await ends(child), true, `the child ${child} outlived the Host`);
  });
}

test('a Plugin Server that ends on its own leaves no child', { skip: SKIP }, async (t) => {
  const host = await bootHost(t, [{ name: 'parting-parent', directory: 'parting-parent' }]);
  const child = await childOf(t, host, 'parting-parent');
  const server = Number((await until(host, /parting-parent: the Plugin Server has pid (\d+)/))[1]);

  // Not the Host's doing: something else ends the Plugin Server.
  process.kill(server, 'SIGTERM');

  await until(host, /the Plugin named parting-parent is Stopped/);
  assert.equal(await ends(child), true, `the child ${child} outlived its Plugin Server`);
});
