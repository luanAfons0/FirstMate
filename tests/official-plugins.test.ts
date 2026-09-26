/**
 * Installing an Official Plugin by its name.
 *
 * It needs no network. git's own URL rewriting, set through the environment,
 * sends every Official Plugin's GitHub URL to a bare repository made inside
 * the test's own temporary directory. FirstMate has no switch for tests; git
 * does this for any program that runs it. It skips itself where git is absent.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, makeHome } from './helpers/host.ts';
import { hasGit, officialSources } from './helpers/git.ts';

async function registry(home: string): Promise<{
  plugins: { name: string; directory: string; grants: string[] }[];
}> {
  return JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as {
    plugins: { name: string; directory: string; grants: string[] }[];
  };
}

test('an Official Plugin is installed by its name alone', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t);
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'worklog'], env);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'worklog');
  assert.ok(installed.stdout.includes(`installed worklog at ${landed}`), installed.stdout);
  assert.ok((await stat(join(landed, 'mcp'))).mode & 0o111, 'mcp is still executable');
  assert.deepEqual(await registry(home), {
    plugins: [{ name: 'worklog', directory: landed, grants: [] }],
  });
});

test('an Official Plugin can be installed under another Plugin Name', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t);
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'scheduler', 'timer'], env);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'timer');
  assert.deepEqual(await registry(home), {
    plugins: [{ name: 'timer', directory: landed, grants: [] }],
  });
});

test('a name already in the Registry is refused before anything is fetched', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t);
  const home = await makeHome(t);
  const elsewhere = await makeHome(t);
  await firstmate(home, ['add', 'nexus', elsewhere]);

  const refused = await firstmate(home, ['install', 'nexus'], env);

  assert.equal(refused.code, 1);
  assert.ok(
    refused.stderr.includes(`nexus is already registered, at ${elsewhere}.`),
    refused.stderr,
  );
  await assert.rejects(stat(join(home, 'shelf', 'nexus')), 'nothing was fetched');
});

test('a bare name that is no Official Plugin says which names are', async (t) => {
  const home = await makeHome(t);

  const refused = await firstmate(home, ['install', 'no-such-plugin']);

  assert.equal(refused.code, 1);
  assert.match(
    refused.stderr,
    /no-such-plugin is not a directory, not a URL and not an Official Plugin\. The Official Plugins are worklog, scheduler, nexus\./,
  );
  await assert.rejects(readFile(join(home, 'registry.json')), 'no row was written');
});

test('a relative path is still refused as it was', async (t) => {
  const home = await makeHome(t);

  const refused = await firstmate(home, ['install', './relative']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /\.\/relative is not an absolute path, and is no URL either\./);
});

test('the help says install takes an Official Plugin name', async (t) => {
  const home = await makeHome(t);

  const help = await firstmate(home, ['--help']);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /the name of an Official Plugin/);
  assert.match(help.stdout, /worklog, scheduler, nexus/);
});
