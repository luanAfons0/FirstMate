/**
 * How `update` will treat a Plugin, as `list` and `status` say it: its Release
 * Version, `clone` (its directory is the top of a git work tree of its own), or
 * `copy` (ADR-0033). The value comes from the Registry row and the directory,
 * never from the Plugin's own files.
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import { DEFAULT_PLACE, bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

/** A copy of a fixture that is the top of a git work tree of its own. */
async function cloneOf(t: TestContext, name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'firstmate-clone-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(fixture(name), directory, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: directory });
  return directory;
}

/** The words after a Plugin's name on its line of `list`. */
function lineOf(output: string, name: string): string {
  const line = output.split('\n').find((one) => one.startsWith(name));
  assert.ok(line !== undefined, `a line for ${name} in:\n${output}`);
  return line;
}

test('list and status show the Release Version, clone or copy of each Plugin', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const home = await makeHome(t);
  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal((await firstmate(home, ['add', 'cloned', await cloneOf(t, 'marker')])).code, 0);
  assert.equal((await firstmate(home, ['add', 'copied', fixture('page-only')])).code, 0);
  await bootHostIn(t, home);

  const listed = await firstmate(home, ['list']);
  const statused = await firstmate(home, ['status']);

  assert.equal(listed.code, 0, listed.stderr);
  assert.match(lineOf(listed.stdout, 'both'), /\b1\.2\.0\b/);
  assert.match(lineOf(listed.stdout, 'cloned'), /\bclone\b/);
  assert.match(lineOf(listed.stdout, 'copied'), /\bcopy\b/);
  assert.equal(statused.code, 0, statused.stderr);
  assert.match(lineOf(statused.stdout, 'both'), /\b1\.2\.0\b/);
  assert.match(lineOf(statused.stdout, 'cloned'), /\bclone\b/);
  assert.match(lineOf(statused.stdout, 'copied'), /\bcopy\b/);

  // --json says the same, by name, beside what it said before.
  const updatesIn = (said: string): Record<string, string> =>
    Object.fromEntries(
      (JSON.parse(said) as { plugins: { name: string; updates: string }[] }).plugins.map(
        (plugin) => [plugin.name, plugin.updates],
      ),
    );
  const expected = { both: '1.2.0', cloned: 'clone', copied: 'copy' };
  assert.deepEqual(updatesIn((await firstmate(home, ['list', '--json'])).stdout), expected);
  assert.deepEqual(updatesIn((await firstmate(home, ['status', '--json'])).stdout), expected);
});

test('a Registry written before Plugin Releases shows clone or copy, and is not rewritten', async (t) => {
  const home = await makeHome(t);
  const clone = await cloneOf(t, 'marker');
  const before = `${JSON.stringify(
    {
      plugins: [
        { name: 'old-clone', place: DEFAULT_PLACE, directory: clone, grants: [] },
        { name: 'old-copy', place: DEFAULT_PLACE, directory: fixture('both'), grants: [] },
      ],
    },
    null,
    2,
  )}\n`;
  await writeFile(join(home, 'registry.json'), before);

  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 0, listed.stderr);
  assert.match(lineOf(listed.stdout, 'old-clone'), /\bclone\b/);
  assert.match(lineOf(listed.stdout, 'old-copy'), /\bcopy\b/);
  assert.equal(await readFile(join(home, 'registry.json'), 'utf8'), before);
});

test("the value is read from the Registry row, not from the Plugin's own files", async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const home = await makeHome(t);
  await firstmate(home, ['install', 'https://github.com/someone/both'], github.env);
  const landed = join(home, 'shelf', 'both');
  await writeFile(join(landed, '.firstmate-release.json'), '{"version":"9.9.9"}');
  await writeFile(join(landed, 'package.json'), '{"version":"8.8.8"}');

  const listed = await firstmate(home, ['list']);

  assert.match(lineOf(listed.stdout, 'both'), /\b1\.2\.0\b/);
  assert.doesNotMatch(listed.stdout, /9\.9\.9|8\.8\.8/);
});
