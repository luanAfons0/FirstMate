/**
 * `firstmate setup`, driven as a script drives it: answers piped in, one per
 * line, and nothing checked but what a person can see — the exit code, what
 * was printed, and the files written.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, makeHome } from './helpers/host.ts';

async function settings(home: string): Promise<{ shelf?: string; shortcuts?: unknown[] }> {
  try {
    return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as {
      shelf?: string;
    };
  } catch {
    return {};
  }
}

/** A directory that is really there, under a home this test owns. */
async function directory(home: string, name: string): Promise<string> {
  const made = join(home, name);
  await mkdir(made);
  return realpath(made);
}

/** Answers, one per line, as a script pipes them in. */
function answers(...lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

test('Enter keeps the Shelf, and a run that changes nothing says nothing more', async (t) => {
  const home = await makeHome(t);

  const run = await firstmate(home, ['setup'], {}, answers(''));

  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.includes(`[${join(home, 'shelf')}]`), 'the Shelf in force is the default');
  assert.doesNotMatch(run.stdout, /setup changed/);
  assert.deepEqual(await settings(home), {});
});

test('a path moves the Shelf, and the summary says so', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const run = await firstmate(home, ['setup'], {}, answers(shelf));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /setup changed:\n {2}the Shelf is now .*plugins/);
  assert.equal((await settings(home)).shelf, shelf);
});

test('a bad Shelf is refused in the words shelf uses, and asked for again', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const alone = await firstmate(home, ['shelf', 'relative/path']);
  const run = await firstmate(home, ['setup'], {}, answers('relative/path', shelf));

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, alone.stderr, 'one rule, one sentence');
  assert.equal(run.stdout.match(/the Shelf\)\?/g)?.length, 2, 'the question came twice');
  assert.equal((await settings(home)).shelf, shelf);
});

test('input that ends early stops setup, keeps what finished, and never hangs', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const nothing = await firstmate(home, ['setup'], {}, '');
  assert.equal(nothing.code, 1);
  assert.match(nothing.stderr, /setup ended before it had every answer\./);

  // A bad answer, then the end: the question was asked, refused, and cut off.
  const cut = await firstmate(home, ['setup'], {}, answers('relative/path'));
  assert.equal(cut.code, 1);
  assert.match(cut.stderr, /setup ended before it had every answer\./);
  assert.deepEqual(await settings(home), {});

  const kept = await firstmate(home, ['setup'], {}, answers(shelf));
  assert.equal(kept.code, 0, kept.stderr);
  assert.equal((await settings(home)).shelf, shelf);
});

test('setup takes nothing on the command line, and the help names it', async (t) => {
  const home = await makeHome(t);

  const extra = await firstmate(home, ['setup', '--shelf', '/tmp']);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /setup takes nothing/);

  const help = await firstmate(home, ['--help']);
  assert.match(help.stdout, /firstmate setup/);
});
