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
 * may add a file to: read-only on Linux, an access rule that refuses new
 * files and directories on Windows, where a read-only directory still takes
 * new files.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
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
    // Only the rights to add a file and to add a directory. `(W)` denies
    // all of write, and with it SYNCHRONIZE, which every open asks for, so
    // the directory could not be listed or read either.
    const everyone = '*S-1-1-0';
    execFileSync('icacls', [directory, '/deny', `${everyone}:(WD,AD)`]);
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

test('a file of data where the new Plugin Release has an empty directory is refused', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  await writeFile(join(plugin, 'logs'), 'the operator’s logs\n');
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await mkdir(join(folder, 'logs'));
  await writeFile(join(folder, 'private.txt'), 'new\n');
  github.publish('someone/both', await pluginRelease(t, folder, 'both', '1.3.0'));
  const before = await everythingIn(home);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(
    updated.stderr.includes(`${join(plugin, 'logs')} is the Plugin's data`),
    updated.stderr,
  );
  assert.deepEqual(await everythingIn(home), before);
  const again = await firstmate(home, ['update', 'both'], github.env);
  assert.equal(again.code, 3, 'the next update says the same, and nothing is left in its way');
});

test('an empty directory the new Plugin Release ships is made', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await mkdir(join(folder, 'logs'));
  github.publish('someone/both', await pluginRelease(t, folder, 'both', '1.3.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.ok((await stat(join(plugin, 'logs'))).isDirectory());
  assert.deepEqual((await readdir(join(home, 'shelf'))).sort(), ['both']);
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

test('update works while mcp.exe runs, and the old one goes once it has ended', async (t) => {
  // A copy of node.exe is a real mcp.exe. Started with a pipe on stdin, it
  // waits for its program there, so it runs, and on Windows its file is
  // locked, as a Plugin Server's is: it can be moved, not removed.
  const github = await serveGitHub(t);
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await copyFile(process.execPath, join(folder, 'mcp.exe'));
  github.publish('someone/both', await pluginRelease(t, folder, 'both', '1.2.0'));
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', 'https://github.com/someone/both'], github.env);
  assert.equal(done.code, 0, done.stderr);
  const plugin = join(home, 'shelf', 'both');
  const previous = join(home, 'shelf', '.both.previous');
  const running = spawn(join(plugin, 'mcp.exe'), [], { stdio: ['pipe', 'ignore', 'ignore'] });
  const ended = new Promise((end) => running.once('exit', end));
  t.after(() => running.kill());
  await new Promise((started, failed) => {
    running.once('spawn', started);
    running.once('error', failed);
  });
  await writeFile(join(folder, 'private.txt'), 'the new words\n');
  github.publish('someone/both', await pluginRelease(t, folder, 'both', '1.3.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: updated both from 1\.2\.0 to 1\.3\.0$/m);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), 'the new words\n');
  if (process.platform === 'win32') {
    assert.ok(updated.stderr.includes(`${previous} could not be removed`), updated.stderr);
  }

  running.kill();
  await ended;
  const again = await firstmate(home, ['update', 'both'], github.env);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual((await readdir(join(home, 'shelf'))).sort(), ['both']);
});
