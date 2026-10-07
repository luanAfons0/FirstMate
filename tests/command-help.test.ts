/**
 * Every command explains itself after --help, and every way a command ends
 * has its own exit code, so that a script can tell one refusal from another
 * without reading the sentence.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

/** Every command, with the words its usage line shows after its name. */
const COMMANDS: readonly [string, string][] = [
  ['setup', ''],
  ['desktop', ''],
  ['place', ' [add <name> <kind> [...] | remove <name>]'],
  ['import', ' <place>'],
  ['add', ' <name> <directory> [--place <name>]'],
  ['remove', ' <name>'],
  ['list', ''],
  ['status', ''],
  ['restart', ' <name>'],
  ['logs', ' [-f]'],
  ['grant', ' <from> <to>'],
  ['revoke', ' <from> <to>'],
  ['shelf', ' [directory] [--place <name>]'],
  ['install', ' <source> [name] [--place <name>]'],
  ['update', ' <name>'],
  ['bind', ' <keys> <plugin> [path]'],
  ['unbind', ' <keys>'],
  ['order', ' [<name> <position>]'],
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

test('setup --help lists the questions setup asks, in order, and names no service', async (t) => {
  const home = await makeHome(t);

  const setup = await firstmate(home, ['setup', '--help']);
  const order = [
    'Shelf and the Places',
    'import',
    'Official Plugins',
    'Grants',
    'Shortcuts',
    'logon',
  ];
  const at = order.map((word) => setup.stdout.indexOf(word));
  assert.ok(
    at.every((place) => place >= 0),
    `setup --help names every question: ${setup.stdout}`,
  );
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    'in the order setup asks them',
  );
  assert.doesNotMatch(setup.stdout, /service/i);

  const bind = await firstmate(home, ['bind', '--help']);
  assert.match(bind.stdout, /The App picks up a Shortcut/);
  assert.doesNotMatch(bind.stdout, /Tray/);

  const logs = await firstmate(home, ['logs', '--help']);
  assert.match(logs.stdout, /firstmate\.log\.old/);
  assert.match((await firstmate(home, ['place', '--help'])).stdout, /place and shelf say/);
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

test('help exit-codes names every exit code and what it means', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['help', 'exit-codes']);

  assert.equal(helped.code, 0, helped.stderr);
  for (const code of [0, 1, 2, 3, 4, 5, 6]) {
    assert.match(helped.stdout, new RegExp(`^  ${code}  it \\w`, 'm'), `exit code ${code}`);
  }
  assert.equal(helped.stderr, '');
});

test('firstmate with no words prints the short help, and ends with 2', async (t) => {
  const home = await makeHome(t);

  const bare = await firstmate(home, []);

  assert.equal(bare.code, 2, 'nothing typed is typed wrong, as it always was');
  assert.match(bare.stdout, /^firstmate: /);
  assert.equal(bare.stderr, '');
  for (const asked of ['--help', '-h']) {
    const helped = await firstmate(home, [asked]);
    assert.equal(helped.code, 0, `${asked}: ${helped.stderr}`);
    assert.equal(helped.stdout, bare.stdout, `${asked} prints the same short help`);
  }
});

test('the short help names every command once, and fits in one screen', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['--help']);
  const lines = helped.stdout.trimEnd().split('\n');

  assert.ok(lines.length < 30, `under 30 lines, not ${lines.length}`);
  for (const line of lines) assert.ok(line.length <= 80, `under 80 columns: ${line}`);
  for (const [name] of COMMANDS) {
    const rows = lines.filter((line) => new RegExp(`^ {2}${name} {2,}\\S`).test(line));
    assert.equal(rows.length, 1, `${name} has one row`);
  }
  for (const group of ['Start', 'Plugins', 'Running', 'Grants and Shortcuts', 'Places']) {
    assert.ok(lines.includes(group), `the group ${group}`);
  }
  assert.match(helped.stdout, /firstmate <command> --help .*--version/);
  assert.match(helped.stdout, /firstmate help <topic> .*exit-codes, environment, places/);
});

test('help <command> prints the same as <command> --help', async (t) => {
  const home = await makeHome(t);

  for (const [name] of COMMANDS) {
    const helped = await firstmate(home, ['help', name]);
    const asked = await firstmate(home, [name, '--help']);

    assert.equal(helped.code, 0, `help ${name}: ${helped.stderr}`);
    assert.equal(helped.stdout, asked.stdout, `help ${name}`);
  }
});

test('help with no topic prints the short help and the topics', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['help']);
  const short = await firstmate(home, ['--help']);

  assert.equal(helped.code, 0, helped.stderr);
  assert.ok(helped.stdout.startsWith(short.stdout.trimEnd()), 'the short help first');
  for (const topic of ['exit-codes', 'environment', 'places']) {
    assert.match(helped.stdout, new RegExp(`^ {2}${topic} {2,}\\S`, 'm'), `the topic ${topic}`);
  }
});

test('help environment names every variable the command line reads, with its default', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['help', 'environment']);

  assert.equal(helped.code, 0, helped.stderr);
  for (const [variable, fallback] of [
    ['FIRSTMATE_HOME', '~/.firstmate'],
    ['FIRSTMATE_SHELF', '$FIRSTMATE_HOME/shelf'],
    ['FIRSTMATE_RELEASES_URL', 'https://github.com/luanAfons0/FirstMate/releases/download'],
  ] as const) {
    const at = helped.stdout.indexOf(variable);
    assert.ok(at >= 0, `names ${variable}`);
    const paragraph = helped.stdout.slice(at).split('\n\n')[0] ?? '';
    assert.ok(paragraph.includes(`Default: ${fallback}`), `${variable} defaults to ${fallback}`);
  }
});

test('help places explains Places, the default Place and a wsl Place', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['help', 'places']);

  assert.equal(helped.code, 0, helped.stderr);
  assert.match(helped.stdout, /A Place is where Plugins are installed/);
  assert.match(helped.stdout, /The\s+default Place is this machine/);
  assert.match(helped.stdout, /place add <name> wsl <distribution>/);
  assert.match(helped.stdout, /update\s+runs\s+git\s+inside\s+the\s+distribution/);

  const update = await firstmate(home, ['update', '--help']);
  assert.match(update.stdout, /A Place is where Plugins are installed/, 'update reaches a Place');
});

test('an unknown help topic is refused in one sentence that names the topics', async (t) => {
  const home = await makeHome(t);

  const refused = await firstmate(home, ['help', 'colours']);

  assert.equal(refused.code, 2);
  assert.equal(refused.stdout, '');
  const lines = refused.stderr.trimEnd().split('\n');
  assert.equal(lines.length, 1, `one line: ${refused.stderr}`);
  assert.match(refused.stderr, /colours/);
  assert.match(refused.stderr, /exit-codes, environment or places/);
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

test('a mistyped command is guessed in one line, and nothing is run', async (t) => {
  const home = await makeHome(t);
  const before = await readdir(home);

  const typo = await firstmate(home, ['lsit']);

  assert.equal(typo.code, 2);
  assert.equal(typo.stdout, '');
  assert.equal(
    typo.stderr,
    'firstmate: no such command: lsit. Did you mean list?\nfirstmate --help says every command.\n',
  );
  assert.deepEqual(await readdir(home), before, 'no file changed');
  const helpWord = await firstmate(home, ['hlep']);
  assert.match(helpWord.stderr, /Did you mean help\?/);
});

test('a command far from every name is refused with no guess', async (t) => {
  const home = await makeHome(t);

  const far = await firstmate(home, ['frobnicate']);

  assert.equal(far.code, 2);
  assert.equal(far.stdout, '');
  assert.equal(
    far.stderr,
    'firstmate: no such command: frobnicate.\nfirstmate --help says every command.\n',
  );
});

test('a short word or a flag gets no wild guess', async (t) => {
  const home = await makeHome(t);

  for (const word of ['stop', 'del', 'srat', '--place', '-x']) {
    const typed = await firstmate(home, [word]);
    assert.equal(typed.code, 2, word);
    assert.equal(
      typed.stderr,
      `firstmate: no such command: ${word}.\nfirstmate --help says every command.\n`,
    );
  }
});

test('a word another tool uses guesses the command FirstMate has for it', async (t) => {
  const home = await makeHome(t);

  for (const [word, meant] of [
    ['uninstall', 'remove'],
    ['start', 'desktop'],
    ['service', 'desktop'],
  ] as const) {
    const typed = await firstmate(home, [word]);
    assert.equal(typed.code, 2, word);
    assert.match(typed.stderr, new RegExp(`no such command: ${word}\\. Did you mean ${meant}\\?`));
  }
});

test('a tie between two names goes to the first in the table', async (t) => {
  const home = await makeHome(t);

  // "remove" and "revoke" are each one edit from "remoke"; remove comes first.
  const tie = await firstmate(home, ['remoke']);

  assert.match(tie.stderr, /Did you mean remove\?/);
});

test('--version and -v say which FirstMate this is, and end with 0', async (t) => {
  const home = await makeHome(t);
  const manifest = JSON.parse(await readFile('apps/cli/package.json', 'utf8')) as {
    version: string;
  };

  for (const asked of ['--version', '-v']) {
    const said = await firstmate(home, [asked]);
    assert.equal(said.code, 0, said.stderr);
    assert.equal(said.stdout, `firstmate ${manifest.version}\n`);
    assert.equal(said.stderr, '');
  }
});

test('help says --version once, in the short help it starts with', async (t) => {
  const home = await makeHome(t);

  const helped = await firstmate(home, ['help']);

  assert.equal(helped.stdout.match(/--version/g)?.length, 1);
});
