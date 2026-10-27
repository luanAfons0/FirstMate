/**
 * Every Plugin Server starts with `FIRSTMATE_PLUGIN` set to its Plugin's name,
 * in every Place, so that it knows its own name and the Host can later find
 * every process under it (ADR-0032). The `namesake` fixture says what it was
 * given, and its own process ID, in answer to a tool call.
 */
import assert from 'node:assert/strict';
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';
import { callTool, stateOf } from './helpers/plugins.ts';
import { fakeWsl, NO_FAKE_WSL } from './helpers/wsl.ts';

/** What the fixture says: the name it was given, and its process ID. */
async function namesake(
  host: Parameters<typeof callTool>[0],
  name: string,
): Promise<{ readonly given: string; readonly pid: string }> {
  const { status, text } = await callTool(host, name, 'who');
  assert.equal(status, 200, host.output());
  const [given = '', pid = ''] = (text ?? '').split(' ');
  return { given, pid };
}

test('a Plugin Server is told the name of its Plugin', async (t) => {
  // Registered under a name that is not its directory's, so the answer can
  // only be the Plugin's name.
  const host = await bootHost(t, [{ name: 'mine', directory: 'namesake' }]);

  assert.equal((await namesake(host, 'mine')).given, 'mine');
});

test('a restarted Plugin Server is a new process, and is told its name again', async (t) => {
  const host = await bootHost(t, [{ name: 'mine', directory: 'namesake' }]);
  const first = await namesake(host, 'mine');

  const restarted = await firstmate(host.home, ['restart', 'mine']);

  assert.equal(restarted.code, 0, restarted.stderr);
  const second = await namesake(host, 'mine');
  assert.equal(second.given, 'mine');
  assert.notEqual(second.pid, first.pid, 'a new run is a new process');
});

test(
  'a Plugin Server in a wsl Place is told its name inside the distribution',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    const directory = '/home/mate/plugins/namesake';
    await mkdir(join(wsl.root, directory), { recursive: true });
    await cp(fixture('namesake'), join(wsl.root, directory), { recursive: true });
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    await firstmate(home, ['add', 'mine', directory, '--place', 'deb']);

    const host = await bootHostIn(t, home, wsl.env);

    assert.equal(await stateOf(host, 'mine'), 'running', host.output());
    // Windows hands wsl.exe's environment to no distribution, so the name
    // crosses on the command line, and env runs ./mcp in its own process.
    assert.ok(
      (await wsl.calls()).includes(
        `wsl.exe -d Debian --cd ${directory} -- env FIRSTMATE_PLUGIN=mine ./mcp`,
      ),
      (await wsl.calls()).join('\n'),
    );
    assert.equal((await namesake(host, 'mine')).given, 'mine');
  },
);
