/**
 * `firstmate import`: a 1.x install comes across from a `wsl` Place, with its
 * Plugins where they already are, their Grants, the Shortcuts, the Plugin
 * Order and the Shelf. What cannot come is refused one sentence at a time, and
 * the 1.x service is turned off only when the operator says yes.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_PLACE, firstmate, fixture, makeHome } from './helpers/host.ts';
import { fakeWsl, NO_FAKE_WSL, type Wsl } from './helpers/wsl.ts';

/** A 1.x home in the fake distribution, as a 1.x Host left it. */
async function oneX(wsl: Wsl, registry: unknown, settings?: unknown): Promise<void> {
  const home = join(wsl.root, wsl.home, '.firstmate');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'registry.json'), JSON.stringify(registry));
  if (settings !== undefined)
    await writeFile(join(home, 'settings.json'), JSON.stringify(settings));
}

const ONE_X_REGISTRY = {
  plugins: [
    { name: 'worklog', directory: '/home/mate/.worklog', grants: [] },
    { name: 'scheduler', directory: '/home/mate/.scheduler', grants: ['worklog'] },
  ],
};

const ONE_X_SETTINGS = {
  shelf: '/home/mate/plugins',
  shortcuts: [{ keys: 'Ctrl+Alt+W', plugin: 'worklog', path: 'new' }],
  order: ['scheduler', 'worklog'],
};

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

test(
  'a 1.x install comes across, every Plugin where it already is',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await oneX(wsl, ONE_X_REGISTRY, ONE_X_SETTINGS);
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);

    const imported = await firstmate(home, ['import', 'deb'], wsl.env);

    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(
      imported.stdout,
      'firstmate: imported worklog at /home/mate/.worklog, in deb\n' +
        'firstmate: imported scheduler at /home/mate/.scheduler, in deb\n' +
        'firstmate: bound Ctrl+Alt+W to open /p/worklog/new\n' +
        'firstmate: the Plugin Order is now scheduler, worklog\n' +
        'firstmate: the Shelf of deb is now /home/mate/plugins\n',
    );
    assert.deepEqual((await readJson(join(home, 'registry.json')))['plugins'], [
      { name: 'worklog', place: 'deb', directory: '/home/mate/.worklog', grants: [] },
      { name: 'scheduler', place: 'deb', directory: '/home/mate/.scheduler', grants: ['worklog'] },
    ]);
    const settings = await readJson(join(home, 'settings.json'));
    assert.deepEqual(settings['shortcuts'], ONE_X_SETTINGS.shortcuts);
    assert.deepEqual(settings['order'], ['scheduler', 'worklog']);
    assert.equal((settings['places'] as { shelf?: string }[])[0]?.shelf, '/home/mate/plugins');
    const oneXRegistry = await readJson(join(wsl.root, wsl.home, '.firstmate', 'registry.json'));
    assert.deepEqual(oneXRegistry, ONE_X_REGISTRY, 'the 1.x files are never written');
  },
);

test(
  'a Plugin Name in use is refused in one sentence, and the rest still come',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await oneX(wsl, ONE_X_REGISTRY, ONE_X_SETTINGS);
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    await firstmate(home, ['add', 'worklog', fixture('both')]);

    const imported = await firstmate(home, ['import', 'deb'], wsl.env);

    assert.equal(imported.code, 5, 'a name that is taken has its own exit code');
    assert.equal(
      imported.stderr,
      `firstmate: worklog is already registered in ${DEFAULT_PLACE}, so it was not imported.\n` +
        'firstmate: Ctrl+Alt+W opened /p/worklog/new, which was not imported.\n',
    );
    assert.match(imported.stdout, /imported scheduler at \/home\/mate\/\.scheduler, in deb/);
    const rows = (await readJson(join(home, 'registry.json')))['plugins'] as { name: string }[];
    assert.deepEqual(
      rows.map((row) => row.name),
      ['worklog', 'scheduler'],
    );
  },
);

test('the 1.x service is turned off only on yes', { skip: NO_FAKE_WSL }, async (t) => {
  const home = await makeHome(t);
  const wsl = await fakeWsl(t, ['Debian'], { service: true });
  await oneX(wsl, { plugins: [] });
  await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);

  const no = await firstmate(home, ['import', 'deb'], wsl.env, 'n\n');
  assert.equal(no.code, 0, no.stderr);
  assert.match(no.stdout, /Turn it off, so the App can listen\? \[Y\/n\]/);
  assert.match(no.stdout, /the 1\.x service in Debian is left as it is/);
  assert.ok(
    !(await wsl.calls()).some((call) => call.includes('disable')),
    'nothing was turned off',
  );

  const yes = await firstmate(home, ['import', 'deb'], wsl.env, 'y\n');
  assert.equal(yes.code, 0, yes.stderr);
  assert.match(yes.stdout, /turned off the 1\.x service in Debian/);
  assert.ok(
    (await wsl.calls()).includes('systemctl --user disable --now firstmate'),
    (await wsl.calls()).join('\n'),
  );
});

test('with no service, import asks nothing', { skip: NO_FAKE_WSL }, async (t) => {
  const home = await makeHome(t);
  const wsl = await fakeWsl(t, ['Debian']);
  await oneX(wsl, { plugins: [] });
  await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);

  const imported = await firstmate(home, ['import', 'deb'], wsl.env);

  assert.equal(imported.code, 0, imported.stderr);
  assert.doesNotMatch(imported.stdout, /Turn it off/);
});

test(
  'a Place with no 1.x install, and a local Place, are each refused',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);

    const none = await firstmate(home, ['import', 'deb'], wsl.env);
    assert.equal(none.code, 4);
    assert.equal(none.stderr, 'firstmate: no 1.x install is in deb, at /home/mate/.firstmate.\n');

    const local = await firstmate(home, ['import', DEFAULT_PLACE], wsl.env);
    assert.equal(local.code, 3);
    assert.equal(
      local.stderr,
      `firstmate: ${DEFAULT_PLACE} is a local Place. A 1.x install is in a wsl one.\n`,
    );
  },
);
