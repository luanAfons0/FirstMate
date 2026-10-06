/**
 * The built command line is the command line.
 *
 * Every other test drives the source. The package holds a bundle of it
 * (ADR-0017), so this one drives the bundle against a Host booted from the
 * source, with the same commands, and asks for the same answers. The bundle
 * carries no Host (ADR-0024): the App holds the Host, and `app.test.ts` boots
 * the packaged App.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bootHost, build, builtFirstmate, fixture, makeHome } from './helpers/host.ts';

test('the built command line writes the Registry and reaches the running Host', async (t) => {
  const firstmate = builtFirstmate(await build(t));
  const host = await bootHost(t, []);

  const added = await firstmate(host.home, ['add', 'both', fixture('both')]);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stdout, `firstmate: added both at ${fixture('both')}\n`);

  const status = await firstmate(host.home, ['status', '--json']);
  assert.equal(status.code, 0, status.stderr);
  const seen = JSON.parse(status.stdout) as { running: boolean; plugins: { name: string }[] };
  assert.equal(seen.running, true);
  assert.deepEqual(
    seen.plugins.map((plugin) => plugin.name),
    ['both'],
    'the reload picked the Plugin up',
  );
});

test('the built command line explains itself, and names no start or service', async (t) => {
  const firstmate = builtFirstmate(await build(t));

  const help = await firstmate('/nowhere', ['--help']);

  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /^ {2}desktop {2,}\S/m);
  assert.doesNotMatch(help.stdout, /^ {2}(start|service) /m);
});

test('the built command line asks setup its questions from piped answers', async (t) => {
  const firstmate = builtFirstmate(await build(t));
  const home = await makeHome(t);

  // The bundle carries the prompt library (ADR-0025), and a pipe still gets
  // the plain questions. Enter keeps the Shelf, and Enter installs nothing.
  // On Windows setup also asks for WSL distributions, and Enter adds none.
  const run = await firstmate(home, ['setup'], {}, '\n\n\n');

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /the Shelf\)\? \[/);
  assert.match(run.stdout, /Which should be installed\? Type their numbers/);
});

test('the built command line says its own version', async (t) => {
  const firstmate = builtFirstmate(await build(t));
  const manifest = JSON.parse(await readFile('apps/cli/package.json', 'utf8')) as {
    version: string;
  };

  const said = await firstmate('/nowhere', ['--version']);

  assert.equal(said.code, 0, said.stderr);
  assert.equal(said.stdout, `firstmate ${manifest.version}\n`);
});
