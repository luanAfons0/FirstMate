/** Shortcuts: bound, unbound and listed from a terminal, and kept beside the Shelf. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

type Written = {
  shelf?: string;
  shortcuts?: { keys: string; plugin: string; path: string }[];
};

/** The settings file, read back exactly as the Host would read it. */
async function settings(home: string): Promise<Written> {
  return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as Written;
}

/** A home with the fixture Plugin `both` in its Registry. */
async function homeWithBoth(t: Parameters<typeof makeHome>[0]): Promise<string> {
  const home = await makeHome(t);
  const added = await firstmate(home, ['add', 'both', fixture('both')]);
  assert.equal(added.code, 0, added.stderr);
  return home;
}

test('bind writes a Shortcut in normal form, and keeps the Shelf', async (t) => {
  const home = await homeWithBoth(t);
  const shelf = join(home, 'plugins');
  await mkdir(shelf);
  const chosen = await realpath(shelf);
  await firstmate(home, ['shelf', chosen]);

  const bound = await firstmate(home, ['bind', 'alt+ctrl+n', 'both', 'new.html']);

  assert.equal(bound.code, 0, bound.stderr);
  assert.equal(bound.stdout, 'firstmate: bound Ctrl+Alt+N to open /p/both/new.html\n');
  assert.deepEqual(await settings(home), {
    shelf: chosen,
    shortcuts: [{ keys: 'Ctrl+Alt+N', plugin: 'both', path: 'new.html' }],
  });
  const written = await stat(join(home, 'settings.json'));
  assert.equal(written.mode & 0o777, 0o600, 'as private as the Registry');
  await assert.rejects(stat(join(home, 'settings.json.pending')), 'nothing is left half written');
});

test('a Shortcut with no path opens the Plugin Page', async (t) => {
  const home = await homeWithBoth(t);

  const bound = await firstmate(home, ['bind', 'Win+Shift+F12', 'both']);

  assert.equal(bound.code, 0, bound.stderr);
  assert.match(bound.stdout, /bound Shift\+Win\+F12 to open \/p\/both\/\n/);
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Shift+Win+F12', plugin: 'both', path: '' },
  ]);
});

test('moving the Shelf keeps the Shortcuts', async (t) => {
  const home = await homeWithBoth(t);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both']);
  await mkdir(join(home, 'plugins'));
  const chosen = await realpath(join(home, 'plugins'));

  const moved = await firstmate(home, ['shelf', chosen]);

  assert.equal(moved.code, 0, moved.stderr);
  assert.deepEqual(await settings(home), {
    shortcuts: [{ keys: 'Ctrl+Alt+N', plugin: 'both', path: '' }],
    shelf: chosen,
  });
});

test('bind refuses keys with no modifier', async (t) => {
  const home = await homeWithBoth(t);

  const refused = await firstmate(home, ['bind', 'N', 'both']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /N has no modifier/);
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');
});

test('bind refuses a key name it does not know, and names the part', async (t) => {
  const home = await homeWithBoth(t);

  for (const [typed, part] of [
    ['Ctrl+Hyper+N', 'Hyper'],
    ['Ctrl+Alt+F25', 'F25'],
    ['Ctrl+Alt+NN', 'NN'],
  ] as const) {
    const refused = await firstmate(home, ['bind', typed, 'both']);
    assert.equal(refused.code, 1, typed);
    assert.ok(refused.stderr.includes(`${part} in ${typed} is not a key`), refused.stderr);
  }
  const twoKeys = await firstmate(home, ['bind', 'Ctrl+A+B', 'both']);
  assert.equal(twoKeys.code, 1);
  assert.match(twoKeys.stderr, /names two keys, A and B/);
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');
});

test('bind refuses a Plugin that is not in the Registry', async (t) => {
  const home = await homeWithBoth(t);

  const refused = await firstmate(home, ['bind', 'Ctrl+Alt+N', 'nobody']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /no Plugin named nobody is registered/);
});

test('bind refuses a path that is absolute or leaves the Plugin', async (t) => {
  const home = await homeWithBoth(t);

  for (const path of [
    '/new.html',
    '../other/',
    'a/../../other/',
    '%2e%2e/other/',
    '//evil.example/',
    'http://evil.example/',
    'a\\..\\b',
  ]) {
    const refused = await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', path]);
    assert.equal(refused.code, 1, path);
    assert.match(refused.stderr, /is not a path inside both's address/, path);
  }
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');
});

test('bind refuses keys already bound, and names the Plugin that holds them', async (t) => {
  const home = await homeWithBoth(t);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', 'new.html']);

  const refused = await firstmate(home, ['bind', 'ALT+CTRL+n', 'page-only']);

  assert.equal(refused.code, 1);
  assert.match(
    refused.stderr,
    /Ctrl\+Alt\+N is already bound to both, to open \/p\/both\/new\.html/,
  );
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Ctrl+Alt+N', plugin: 'both', path: 'new.html' },
  ]);
});

test('unbind removes a Shortcut, in any letter case and order', async (t) => {
  const home = await homeWithBoth(t);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', 'new.html']);
  await firstmate(home, ['bind', 'Ctrl+Alt+M', 'both']);

  const unbound = await firstmate(home, ['unbind', 'alt+ctrl+n']);

  assert.equal(unbound.code, 0, unbound.stderr);
  assert.equal(unbound.stdout, 'firstmate: unbound Ctrl+Alt+N, which opened /p/both/new.html\n');
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Ctrl+Alt+M', plugin: 'both', path: '' },
  ]);

  await firstmate(home, ['unbind', 'Ctrl+Alt+M']);
  assert.deepEqual(await settings(home), {}, 'no Shortcut leaves no array behind');
});

test('unbind of keys that are not bound says so and fails', async (t) => {
  const home = await homeWithBoth(t);

  const refused = await firstmate(home, ['unbind', 'Ctrl+Alt+N']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /Ctrl\+Alt\+N is not bound/);
});

test('list prints the Shortcuts after the Plugins', async (t) => {
  const home = await homeWithBoth(t);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', 'new.html']);
  await firstmate(home, ['bind', 'Ctrl+Alt+M', 'both']);

  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(
    listed.stdout,
    `both\t${fixture('both')}\n` +
      'Ctrl+Alt+N\topens /p/both/new.html\n' +
      'Ctrl+Alt+M\topens /p/both/\n',
  );
});

test('remove takes the Plugin\'s Shortcuts with it, and says which', async (t) => {
  const home = await homeWithBoth(t);
  await firstmate(home, ['add', 'page-only', fixture('page-only')]);
  await firstmate(home, ['bind', 'Ctrl+Alt+N', 'both', 'new.html']);
  await firstmate(home, ['bind', 'Ctrl+Alt+P', 'page-only']);

  const removed = await firstmate(home, ['remove', 'both']);

  assert.equal(removed.code, 0, removed.stderr);
  assert.match(removed.stdout, /unbound Ctrl\+Alt\+N, which opened \/p\/both\/new\.html/);
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Ctrl+Alt+P', plugin: 'page-only', path: '' },
  ]);
});

test('a damaged Shortcut fails every command loudly', async (t) => {
  const home = await homeWithBoth(t);

  for (const [shortcuts, said] of [
    ['"Ctrl+Alt+N"', /need "shortcuts" to be an array/],
    ['[{"keys": "alt+ctrl+n", "plugin": "both", "path": ""}]', /needs "keys" in normal form/],
    ['[{"keys": "Ctrl+Alt+N", "plugin": "Both!", "path": ""}]', /needs "plugin" to be a Plugin/],
    ['[{"keys": "Ctrl+Alt+N", "plugin": "both", "path": "/x"}]', /needs "path" to be a relative/],
    [
      '[{"keys": "Ctrl+Alt+N", "plugin": "both", "path": ""},' +
        ' {"keys": "Ctrl+Alt+N", "plugin": "both", "path": "x"}]',
      /bind Ctrl\+Alt\+N twice/,
    ],
  ] as const) {
    await writeFile(join(home, 'settings.json'), `{"shortcuts": ${shortcuts}}\n`);
    for (const argv of [['list'], ['shelf'], ['bind', 'Ctrl+Alt+Q', 'both']]) {
      const broken = await firstmate(home, argv);
      assert.equal(broken.code, 1, `${argv.join(' ')} with ${shortcuts}`);
      assert.match(broken.stderr, said, shortcuts);
    }
  }
});

test('bind and unbind take the right number of words', async (t) => {
  const home = await makeHome(t);

  const bindAlone = await firstmate(home, ['bind', 'Ctrl+Alt+N']);
  assert.equal(bindAlone.code, 2, 'the wrong shape of invocation, not a refusal');
  assert.match(bindAlone.stderr, /bind takes keys, a Plugin Name, and a path or nothing/);

  const unbindTwo = await firstmate(home, ['unbind', 'Ctrl+Alt+N', 'Ctrl+Alt+M']);
  assert.equal(unbindTwo.code, 2);
  assert.match(unbindTwo.stderr, /unbind takes the keys of one Shortcut/);
});
