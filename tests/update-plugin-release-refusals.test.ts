/**
 * `firstmate update <name>` of a Plugin Release never loses data and never
 * leaves a broken Plugin (ADR-0033). Before any change it refuses a Plugin
 * directory it cannot update safely: data where a new Release File goes, or
 * an old Release File changed or gone. When a move fails part way, the old
 * Release Files go back, and the record and the Registry row stay as they
 * were.
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`, and every
 * Plugin Release is made by the archive script the release workflow runs.
 * A move is made to fail with a directory of the Plugin's data that no one
 * may write to: read-only on Linux, an access rule that refuses writes on
 * Windows, where a read-only directory still takes new files.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub, type FakeGitHub } from './helpers/github.ts';
import { bootHostIn, firstmate, fixture, makeHome, until } from './helpers/host.ts';

/** A Plugin Release of the `both` fixture at this Release Version, with these files written. */
async function releaseOf(
  t: TestContext,
  version: string,
  write: Readonly<Record<string, string>> = {},
) {
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  for (const [path, words] of Object.entries(write)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), words);
  }
  return pluginRelease(t, folder, 'both', version);
}

/** A home with `both` installed from its Plugin Release 1.2.0, and the Plugin's directory. */
async function installed(
  t: TestContext,
  github: FakeGitHub,
): Promise<{ readonly home: string; readonly plugin: string }> {
  github.publish('someone/both', await releaseOf(t, '1.2.0'));
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', 'https://github.com/someone/both'], github.env);
  assert.equal(done.code, 0, done.stderr);
  return { home, plugin: join(home, 'shelf', 'both') };
}

/** Every path under a directory, with the contents of each file, so any change shows. */
async function snapshot(directory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const key = path.slice(directory.length + 1).replace(/\\/g, '/');
    out[key] = entry.isFile() ? await readFile(path, 'utf8') : '<directory>';
  }
  return out;
}

/** What `update` must leave as it found: the Plugin's directory, the Shelf, the Registry. */
async function everythingIn(home: string): Promise<unknown> {
  return {
    plugin: await snapshot(join(home, 'shelf', 'both')),
    shelf: (await readdir(join(home, 'shelf'))).sort(),
    registry: await readFile(join(home, 'registry.json'), 'utf8'),
  };
}

/**
 * Make a directory refuse new files, the way the system the test runs on
 * can, and give back what lets it take them again: on Windows a read-only
 * directory still takes them, so an access rule refuses writes there instead.
 */
async function refuseWritesIn(directory: string): Promise<() => Promise<void>> {
  if (process.platform === 'win32') {
    const everyone = '*S-1-1-0';
    execFileSync('icacls', [directory, '/deny', `${everyone}:(W)`]);
    return async () => {
      execFileSync('icacls', [directory, '/remove:d', everyone]);
    };
  }
  await chmod(directory, 0o555);
  return () => chmod(directory, 0o755);
}

/** Whether a directory without write rights can refuse this test: root writes to it all the same. */
const ROOT = process.platform !== 'win32' && process.getuid?.() === 0;

test('data where the new Plugin Release ships a file is refused, and nothing changes', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  await writeFile(join(plugin, 'notes.txt'), 'the operator’s notes\n');
  github.publish('someone/both', await releaseOf(t, '1.3.0', { 'notes.txt': 'shipped\n' }));
  const before = await everythingIn(home);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(
    updated.stderr.includes(`${join(plugin, 'notes.txt')} is the Plugin's data`),
    updated.stderr,
  );
  assert.match(updated.stderr, /move it out of the Plugin's directory, then run update again/);
  assert.deepEqual(await everythingIn(home), before);
});

test('a file of data where the new Plugin Release needs a directory is refused too', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  await writeFile(join(plugin, 'notes'), 'the operator’s notes\n');
  github.publish('someone/both', await releaseOf(t, '1.3.0', { 'notes/readme.txt': 'shipped\n' }));
  const before = await everythingIn(home);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(
    updated.stderr.includes(`${join(plugin, 'notes')} is the Plugin's data`),
    updated.stderr,
  );
  assert.deepEqual(await everythingIn(home), before);
});

test('a Release File the operator changed is refused, and nothing changes', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  await writeFile(join(plugin, 'web', 'app.css'), 'body { color: red }\n');
  github.publish('someone/both', await releaseOf(t, '1.3.0', { 'private.txt': 'new\n' }));
  const before = await everythingIn(home);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(
    updated.stderr.includes(`${join(plugin, 'web', 'app.css')} has changed since`),
    updated.stderr,
  );
  assert.match(updated.stderr, /put back the file of Plugin Release 1\.2\.0/);
  assert.deepEqual(await everythingIn(home), before);
});

test('a missing Release File is refused, and nothing changes', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  await rm(join(plugin, 'web', 'nested', 'deep.txt'));
  github.publish('someone/both', await releaseOf(t, '1.3.0', { 'private.txt': 'new\n' }));
  const before = await everythingIn(home);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(
    updated.stderr.includes(`${join(plugin, 'web', 'nested', 'deep.txt')} is gone`),
    updated.stderr,
  );
  assert.match(updated.stderr, /put back the file of Plugin Release 1\.2\.0/);
  assert.deepEqual(await everythingIn(home), before);
});

test(
  'a move that fails part way puts the old Release Files back, and the Plugin Server still starts',
  { skip: ROOT && 'root writes to a read-only directory, so no move fails' },
  async (t) => {
    const github = await serveGitHub(t);
    const { home, plugin } = await installed(t, github);
    // The Plugin's own directory of data, which the new Plugin Release ships
    // a file into: the moves out of the old Release Files are done, and some
    // moves in, when this one fails.
    await mkdir(join(plugin, 'notes'));
    await writeFile(join(plugin, 'notes', 'mine.txt'), 'kept\n');
    github.publish(
      'someone/both',
      await releaseOf(t, '1.3.0', {
        'private.txt': 'the new words\n',
        'notes/readme.txt': 'shipped\n',
        'added/new.txt': 'new\n',
      }),
    );
    const before = await everythingIn(home);
    const allow = await refuseWritesIn(join(plugin, 'notes'));
    try {
      const updated = await firstmate(home, ['update', 'both'], github.env);

      assert.equal(updated.code, 1, updated.stdout);
      assert.ok(updated.stderr.includes(join(plugin, 'notes', 'readme.txt')), updated.stderr);
      assert.match(
        updated.stderr,
        /put the old Release Files of both back, and both is still on 1\.2\.0/,
      );
      assert.deepEqual(await everythingIn(home), before);
      const host = await bootHostIn(t, home);
      await until(host, /both: private\.txt says this file is outside/);
    } finally {
      await allow();
    }

    // Nothing is left that stops the next update, once the move can be done.
    const again = await firstmate(home, ['update', 'both'], github.env);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(await readFile(join(plugin, 'notes', 'readme.txt'), 'utf8'), 'shipped\n');
    assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), 'the new words\n');
  },
);

test(
  'on Windows, update works while the Plugin Server runs from mcp.exe',
  {
    skip:
      'no fixture ships a real mcp.exe Plugin Server: it needs a native build. ' +
      'A rename works on a running mcp.exe, and finishUpdate removes the old one after the restart.',
  },
  () => {},
);
