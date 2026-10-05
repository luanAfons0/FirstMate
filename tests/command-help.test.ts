/**
 * Every command explains itself after --help, and every way a command ends
 * has its own exit code, so that a script can tell one refusal from another
 * without reading the sentence.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

/** Every command, with the words its usage line shows after its name. */
const COMMANDS: readonly [string, string][] = [
  ['start', ''],
  ['setup', ''],
  ['desktop', ''],
  ['add', ' <name> <directory>'],
  ['remove', ' <name>'],
  ['list', ''],
  ['status', ''],
  ['restart', ' <name>'],
  ['grant', ' <from> <to>'],
  ['revoke', ' <from> <to>'],
  ['shelf', ' [directory]'],
  ['install', ' <source> [name]'],
  ['bind', ' <keys> <plugin> [path]'],
  ['unbind', ' <keys>'],
  ['order', ' [<name> <position>]'],
  ['service', ' on|off'],
];

test('--help and -h after every command print its usage and do nothing else', async (t) => {
  const home = await makeHome(t);

  for (const [name, takes] of COMMANDS) {
    for (const asked of ['--help', '-h']) {
      // Help is asked for in place of the command's own words, so even a
      // command that would start the Host or ask questions only explains.
      const helped = await firstmate(home, [name, asked]);

      assert.equal(helped.code, 0, `${name} ${asked}: ${helped.stderr}`);
      // A long usage line says what the command does on the line below it.
      const [, typed] = /^usage:\n {2}firstmate (.*?)(?: {2,}|\n)/.exec(helped.stdout) ?? [];
      assert.equal(typed, `${name}${takes}`, `${name} ${asked} starts with its own usage line`);
      assert.equal(helped.stdout.match(/^ {2}firstmate /gm)?.length, 1, 'and no other');
      assert.equal(helped.stderr, '');
    }
  }
});

test("a command's help carries the notes about the words it takes", async (t) => {
  const home = await makeHome(t);

  const bind = await firstmate(home, ['bind', '--help']);
  assert.match(bind.stdout, /A Shortcut is one or more of Ctrl, Alt, Shift and Win/);
  assert.doesNotMatch(bind.stdout, /The Plugin Order is/);

  const order = await firstmate(home, ['order', 'both', '--help']);
  assert.equal(order.code, 0, 'help wins wherever it is typed');
  assert.match(order.stdout, /The Plugin Order is the order every list of Plugins shows them in/);
});

test('a command typed wrong shows its own help, and not every command', async (t) => {
  const home = await makeHome(t);

  const wrong = await firstmate(home, ['add', 'both']);

  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /^firstmate: add takes a Plugin Name and a directory\.\n\nusage:\n/);
  assert.match(wrong.stderr, /firstmate add <name> <directory>/);
  assert.doesNotMatch(wrong.stderr, /firstmate remove/);
});

test('the usage names every exit code and what it means', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['--help']);

  assert.equal(helped.code, 0);
  for (const code of [0, 1, 2, 3, 4, 5, 6]) {
    assert.match(helped.stdout, new RegExp(`^  ${code}  it \\w`, 'm'), `exit code ${code}`);
  }
});

test('each kind of refusal ends with its own exit code', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'both', fixture('both')]);

  const done = await firstmate(home, ['list']);
  assert.equal(done.code, 0, 'done');

  const typedWrong = await firstmate(home, ['remove']);
  assert.equal(typedWrong.code, 2, 'typed wrong');

  const invalid = await firstmate(home, ['add', 'Not A Name', fixture('both')]);
  assert.equal(invalid.code, 3, 'a value that is not what it must be');
  assert.match(invalid.stderr, /is not a Plugin Name/);

  const missing = await firstmate(home, ['remove', 'nobody']);
  assert.equal(missing.code, 4, 'a Plugin that is not there');
  assert.match(missing.stderr, /no Plugin named nobody is registered/);

  const unbound = await firstmate(home, ['unbind', 'Ctrl+Alt+N']);
  assert.equal(unbound.code, 4, 'a Shortcut that is not there');

  const taken = await firstmate(home, ['add', 'both', fixture('page-only')]);
  assert.equal(taken.code, 5, 'a name that is taken already');
  assert.match(taken.stderr, /both is already registered/);

  await writeFile(join(home, 'registry.json'), 'not json');
  const failed = await firstmate(home, ['list']);
  assert.equal(failed.code, 1, 'a damaged file is a failure, not a refusal');
  assert.match(failed.stderr, /is not valid JSON/);
});
