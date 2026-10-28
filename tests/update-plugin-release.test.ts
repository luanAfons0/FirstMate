/**
 * `firstmate update <name>` of a Plugin installed from a Plugin Release takes
 * the newest Plugin Release in the same MAJOR, replaces the Release Files
 * with its own, and restarts the Plugin Server through the running Host. Every
 * file that is not a Release File is the Plugin's data, and stays as it was
 * (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`, and every
 * Plugin Release is made by the archive script the release workflow runs,
 * from a copy of a fixture changed the way a new Release Version changes it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub, type FakeGitHub } from './helpers/github.ts';
import { bootHostIn, canStart, firstmate, fixture, makeHome, until } from './helpers/host.ts';

type Registry = {
  plugins: { name: string; release?: { repository: string; version: string } }[];
};

/** What a new Release Version does to the files of the one before it. */
type Change = {
  /** Files to write, by their path in the Plugin, with their new contents. */
  readonly write?: Readonly<Record<string, string>>;
  /** Paths the new Release Version no longer ships. */
  readonly drop?: readonly string[];
  /** Symbolic links to ship, by their path, with their targets. */
  readonly link?: Readonly<Record<string, string>>;
};

/** A Plugin Release of the `both` fixture at this Release Version, changed so. */
async function releaseOf(t: TestContext, version: string, change: Change = {}) {
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  for (const [path, words] of Object.entries(change.write ?? {})) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), words);
  }
  for (const path of change.drop ?? []) await rm(join(folder, path), { recursive: true });
  for (const [path, target] of Object.entries(change.link ?? {})) {
    await symlink(target, join(folder, path));
  }
  return pluginRelease(t, folder, 'both', version);
}

/** A home with `both` installed from its Plugin Release 1.2.0, and the Plugin's directory. */
async function installed(
  t: TestContext,
  github: FakeGitHub,
  change: Change = {},
): Promise<{ readonly home: string; readonly plugin: string }> {
  github.publish('someone/both', await releaseOf(t, '1.2.0', change));
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', 'https://github.com/someone/both'], github.env);
  assert.equal(done.code, 0, done.stderr);
  return { home, plugin: join(home, 'shelf', 'both') };
}

async function registry(home: string): Promise<Registry> {
  return JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as Registry;
}

async function recordOf(plugin: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(plugin, '.firstmate-release.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function sha256(words: string): string {
  return createHash('sha256').update(words).digest('hex');
}

/** Every path under a directory, files and directories, sorted. */
async function everything(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true }))
    .map((path) => path.replace(/\\/g, '/'))
    .sort();
}

test('a newer Plugin Release in the same MAJOR replaces the Release Files and keeps the data', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  // The Plugin's own data, beside the Release Files and among them.
  await writeFile(join(plugin, 'worklog.db'), 'the operator’s work\n');
  await writeFile(join(plugin, 'web', 'nested', 'mine.txt'), 'kept\n');
  github.publish(
    'someone/both',
    await releaseOf(t, '1.3.0', {
      write: { 'private.txt': 'the new words\n', 'web/added/new.txt': 'new\n' },
      drop: ['web/app.css', 'web/nested/deep.txt', 'web/LICENSE'],
    }),
  );

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: updated both from 1\.2\.0 to 1\.3\.0$/m);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), 'the new words\n');
  assert.equal(await readFile(join(plugin, 'web', 'added', 'new.txt'), 'utf8'), 'new\n');
  assert.equal(await readFile(join(plugin, 'worklog.db'), 'utf8'), 'the operator’s work\n');
  assert.equal(await readFile(join(plugin, 'web', 'nested', 'mine.txt'), 'utf8'), 'kept\n');
  assert.ok(await canStart(plugin), 'mcp is still executable');
  assert.deepEqual(await everything(plugin), [
    '.firstmate-release.json',
    'mcp',
    'mcp.cmd',
    'private.txt',
    'web',
    'web/added',
    'web/added/new.txt',
    'web/app.js',
    'web/index.html',
    'web/nested',
    'web/nested/mine.txt',
    'web/thing.bin',
    'worklog.db',
  ]);
  const record = (await recordOf(plugin))['files'] as Record<string, string>;
  assert.deepEqual(Object.keys(record), [
    'mcp',
    'mcp.cmd',
    'private.txt',
    'web/added/new.txt',
    'web/app.js',
    'web/index.html',
    'web/thing.bin',
  ]);
  assert.equal(record['private.txt'], sha256('the new words\n'));
  assert.deepEqual((await registry(home)).plugins[0]?.release, {
    repository: 'someone/both',
    version: '1.3.0',
  });
  assert.deepEqual(
    (await readdir(join(home, 'shelf'))).sort(),
    ['both'],
    'nothing is left behind in the Shelf',
  );
});

test('a directory a dropped Release File leaves empty is removed', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  github.publish('someone/both', await releaseOf(t, '1.2.1', { drop: ['web/nested'] }));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(existsSync(join(plugin, 'web', 'nested')), false);
  assert.ok(existsSync(join(plugin, 'web', 'index.html')));
});

test('the Plugin Server is restarted through the running Host, which serves the new files', async (t) => {
  const github = await serveGitHub(t);
  const { home } = await installed(t, github);
  const host = await bootHostIn(t, home);
  await until(host, /both: private\.txt says this file is outside/);
  github.publish(
    'someone/both',
    await releaseOf(t, '1.3.0', {
      write: { 'private.txt': 'the new words\n', 'web/index.html': 'the new Plugin Page\n' },
    }),
  );

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: restarted both\. It is Running\.$/m);
  await until(host, /both: private\.txt says the new words/);
  assert.equal(await (await host.fetch('/p/both/')).text(), 'the new Plugin Page\n');
});

test('already on the newest Plugin Release: no output, exit 0, nothing changed', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const before = await everything(plugin);
  const rows = await readFile(join(home, 'registry.json'), 'utf8');

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(updated.stdout, '');
  assert.equal(updated.stderr, '');
  assert.deepEqual(await everything(plugin), before);
  assert.equal(await readFile(join(home, 'registry.json'), 'utf8'), rows);
  assert.equal(
    github.asked.filter((path) => path.includes('/download/')).length,
    2,
    'only the install downloaded anything',
  );
});

test('a newer MAJOR is not taken, and an older Release Version never is', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  github.publish(
    'someone/both',
    await releaseOf(t, '1.1.9', { write: { 'private.txt': 'old\n' } }),
  );
  github.publish(
    'someone/both',
    await releaseOf(t, '1.4.0', { write: { 'private.txt': 'one\n' } }),
  );
  github.publish(
    'someone/both',
    await releaseOf(t, '2.0.0', { write: { 'private.txt': 'two\n' } }),
  );

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: updated both from 1\.2\.0 to 1\.4\.0$/m);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), 'one\n');
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.4.0');
});

test(
  'a symbolic link is a Release File too: a dropped one is gone, a kept one is new',
  { skip: process.platform === 'win32' && 'a symbolic link needs a privilege on Windows' },
  async (t) => {
    const github = await serveGitHub(t);
    // `lib` comes before its target in the archive, and is still a link to
    // a directory: on Windows, one made before its target is a file link.
    const { home, plugin } = await installed(t, github, {
      link: { lib: 'web/nested', 'web/home.html': 'index.html', 'web/old.css': 'app.css' },
    });
    assert.deepEqual((await recordOf(plugin))['links'], {
      lib: 'web/nested',
      'web/home.html': 'index.html',
      'web/old.css': 'app.css',
    });
    assert.deepEqual(await readdir(join(plugin, 'lib')), ['deep.txt']);
    github.publish(
      'someone/both',
      await releaseOf(t, '1.3.0', { link: { 'web/home.html': 'app.js' } }),
    );

    const updated = await firstmate(home, ['update', 'both'], github.env);

    assert.equal(updated.code, 0, updated.stderr);
    assert.equal(existsSync(join(plugin, 'web', 'old.css')), false);
    assert.equal(
      await readFile(join(plugin, 'web', 'home.html'), 'utf8'),
      await readFile(fixture('both/web/app.js'), 'utf8'),
    );
    assert.deepEqual((await recordOf(plugin))['links'], { 'web/home.html': 'app.js' });
  },
);

test('a directory of old Release Files makes way for a new Release File at its path', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const folder = join(await makeHome(t), 'both');
  await cp(fixture('both'), folder, { recursive: true });
  await rm(join(folder, 'web', 'nested'), { recursive: true });
  await writeFile(join(folder, 'web', 'nested'), 'a file now\n');
  github.publish('someone/both', await pluginRelease(t, folder, 'both', '1.3.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(await readFile(join(plugin, 'web', 'nested'), 'utf8'), 'a file now\n');
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.3.0');
});

test('a Release File whose name changes only in case is not taken for data', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  github.publish(
    'someone/both',
    await releaseOf(t, '1.3.0', { drop: ['private.txt'], write: { 'Private.txt': 'cased\n' } }),
  );

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(await readFile(join(plugin, 'Private.txt'), 'utf8'), 'cased\n');
  assert.ok((await readdir(plugin)).includes('Private.txt'), 'the name has its new case');
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.3.0');
});

test('old Release Files left by an update that ended are removed, and the next update runs', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  // What a clean-up that failed leaves: the old Release Files and the old
  // record, while the Plugin's directory holds the new record.
  const previous = join(home, 'shelf', '.both.previous');
  await cp(plugin, previous, { recursive: true });
  github.publish(
    'someone/both',
    await releaseOf(t, '1.3.0', { write: { 'private.txt': 'new\n' } }),
  );

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(existsSync(previous), false);
  assert.equal(await readFile(join(plugin, 'private.txt'), 'utf8'), 'new\n');
});

test('a record that names a path outside the Plugin is refused, and nothing moves', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const other = join(home, 'shelf', 'other');
  await mkdir(other);
  await writeFile(join(other, 'mcp.js'), 'another Plugin\n');
  const record = await recordOf(plugin);
  const files = { ...(record['files'] as Record<string, string>) };
  files['../other/mcp.js'] = sha256('another Plugin\n');
  await writeFile(join(plugin, '.firstmate-release.json'), JSON.stringify({ files }));
  github.publish('someone/both', await releaseOf(t, '1.3.0'));

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.match(updated.stderr, /is not FirstMate's record of Release Files/);
  assert.equal(await readFile(join(other, 'mcp.js'), 'utf8'), 'another Plugin\n');
});

test('old Release Files left by an update that did not end are refused, and kept', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const previous = join(home, 'shelf', '.both.previous');
  await mkdir(previous);
  await writeFile(join(previous, 'private.txt'), 'the only copy\n');
  github.publish('someone/both', await releaseOf(t, '1.3.0'));
  const before = await everything(plugin);

  const updated = await firstmate(home, ['update', 'both'], github.env);

  assert.equal(updated.code, 3, updated.stdout);
  assert.ok(updated.stderr.includes(`${previous} is left from an update of both`), updated.stderr);
  assert.equal(await readFile(join(previous, 'private.txt'), 'utf8'), 'the only copy\n');
  assert.deepEqual(await everything(plugin), before);
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.2.0');
});

test('a repository GitHub no longer shows is refused, and nothing changes', async (t) => {
  const github = await serveGitHub(t);
  const { home, plugin } = await installed(t, github);
  const before = await everything(plugin);
  const gone = await serveGitHub(t);

  const updated = await firstmate(home, ['update', 'both'], gone.env);

  assert.equal(updated.code, 4, updated.stdout);
  assert.match(updated.stderr, /GitHub no longer shows someone\/both/);
  assert.deepEqual(await everything(plugin), before);
});
