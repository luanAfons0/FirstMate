/**
 * When a Plugin Server ends, every process it started ends with it: a
 * restart, a Host stop and a Plugin Server that ends on its own leave no
 * child of it running.
 *
 * Each fixture's Plugin Server starts a child. `stubborn-parent` and its
 * child ignore SIGTERM, so both are killed; `parting-parent` ends on SIGTERM
 * and leaves behind a child that ignores it. `tidy-parent`'s child ends on
 * SIGTERM, a little later, so it shows that the rest of a Plugin Server's
 * group gets the same grace as the Plugin Server. Linux alone: on Windows the
 * Host already ends the whole tree with `taskkill /t` (ADR-0019), and this
 * test reads `/proc`.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { bootHost, firstmate, until, type Booted } from './helpers/host.ts';
import { isRunning, untilTrue } from './helpers/processes.ts';

const SKIP =
  process.platform === 'linux'
    ? false
    : 'Linux alone: Windows ends a Plugin Server with taskkill /t, and this test reads /proc';

/**
 * How long a child has to end before the test says it lives: the five seconds
 * of grace the Host gives a Plugin Server's group, and time to reap it.
 */
const REAP_MS = 10_000;

/**
 * The pid of the child a Plugin Server started, said after `from` in the
 * Host's output. A child left running is killed when the test ends, so that
 * a failed test leaves nothing behind.
 */
async function childOf(t: TestContext, host: Booted, name: string, from = 0): Promise<number> {
  // Not a /g pattern: its lastIndex would move between asks, and find a line said before `from`.
  const said = new RegExp(`${name}: started a child with pid (\\d+)`);
  await until(host, { exec: (output: string) => said.exec(output.slice(from)) } as RegExp);
  const pid = Number(said.exec(host.output().slice(from))?.[1]);
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
    await untilTrue(() => !isRunning(child), REAP_MS, `the child ${child} outlived the restart`);
  });

  test(`a Host stop leaves no child of ${name}`, { skip: SKIP }, async (t) => {
    const host = await bootHost(t, [{ name, directory: name }]);
    const child = await childOf(t, host, name);

    await host.stop();

    assert.match(host.output(), onSigterm);
    await untilTrue(() => !isRunning(child), REAP_MS, `the child ${child} outlived the Host`);
  });
}

test('a Plugin Server that ends on its own leaves no child', { skip: SKIP }, async (t) => {
  const host = await bootHost(t, [{ name: 'parting-parent', directory: 'parting-parent' }]);
  const child = await childOf(t, host, 'parting-parent');
  const server = Number((await until(host, /parting-parent: the Plugin Server has pid (\d+)/))[1]);

  // Not the Host's doing: something else ends the Plugin Server.
  process.kill(server, 'SIGTERM');

  await until(host, /the Plugin named parting-parent is Stopped/);
  await untilTrue(
    () => !isRunning(child),
    REAP_MS,
    `the child ${child} outlived its Plugin Server`,
  );
});

test('a child of a restarted Plugin Server has time to end cleanly', { skip: SKIP }, async (t) => {
  const host = await bootHost(t, [{ name: 'tidy-parent', directory: 'tidy-parent' }]);
  const child = await childOf(t, host, 'tidy-parent');
  await until(host, /tidy-parent: the child waits for SIGTERM/);

  const restarted = await firstmate(host.home, ['restart', 'tidy-parent']);

  assert.equal(restarted.code, 0, restarted.stderr);
  await untilTrue(() => !isRunning(child), REAP_MS, `the child ${child} outlived the restart`);
  assert.match(host.output(), /tidy-parent: the child ended cleanly/);
});

test(
  'a child of a Plugin Server that ends on its own has time to end cleanly',
  { skip: SKIP },
  async (t) => {
    const host = await bootHost(t, [{ name: 'tidy-parent', directory: 'tidy-parent' }]);
    const child = await childOf(t, host, 'tidy-parent');
    await until(host, /tidy-parent: the child waits for SIGTERM/);
    const server = Number((await until(host, /tidy-parent: the Plugin Server has pid (\d+)/))[1]);

    // Not the Host's doing: something else ends the Plugin Server alone.
    process.kill(server, 'SIGTERM');

    await untilTrue(
      () => !isRunning(child),
      REAP_MS,
      `the child ${child} outlived its Plugin Server`,
    );
    assert.match(host.output(), /tidy-parent: the child ended cleanly/);
  },
);

test(
  'a Host stop waits for a child of a Plugin Server to end cleanly',
  { skip: SKIP },
  async (t) => {
    const host = await bootHost(t, [{ name: 'tidy-parent', directory: 'tidy-parent' }]);
    const child = await childOf(t, host, 'tidy-parent');
    await until(host, /tidy-parent: the child waits for SIGTERM/);

    await host.stop();

    assert.equal(isRunning(child), false, `the child ${child} outlived the Host`);
    assert.match(host.output(), /tidy-parent: the child ended cleanly/);
  },
);
