/**
 * `firstmate setup`, driven as a script drives it: answers piped in, one per
 * line, and nothing checked but what a person can see — the exit code, what
 * was printed, and the files written.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { hasGit, officialSources } from './helpers/git.ts';
import { firstmate, makeHome, type CommandResult } from './helpers/host.ts';
import { binWith, machine } from './helpers/systemd.ts';

/**
 * One run of `setup` on a machine with no systemd: git is on `PATH`, and no
 * `systemctl` is, so no test here can reach the real one.
 */
async function setupIn(
  t: TestContext,
  home: string,
  input: string,
  env: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return firstmate(home, ['setup'], { PATH: await binWith(t, ['git']), ...env }, input);
}

async function registry(
  home: string,
): Promise<{ name: string; directory: string; grants: string[] }[]> {
  try {
    return (
      JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as {
        plugins: { name: string; directory: string; grants: string[] }[];
      }
    ).plugins;
  } catch {
    return [];
  }
}

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

  const run = await setupIn(t, home, answers('', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.includes(`[${join(home, 'shelf')}]`), 'the Shelf in force is the default');
  assert.doesNotMatch(run.stdout, /setup changed/);
  assert.deepEqual(await settings(home), {});
});

test('a path moves the Shelf, and the summary says so', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const run = await setupIn(t, home, answers(shelf, ''));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /setup changed:\n {2}the Shelf is now .*plugins/);
  assert.equal((await settings(home)).shelf, shelf);
});

test('a bad Shelf is refused in the words shelf uses, and asked for again', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const alone = await firstmate(home, ['shelf', 'relative/path']);
  const run = await setupIn(t, home, answers('relative/path', shelf, ''));

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, alone.stderr, 'one rule, one sentence');
  assert.equal(run.stdout.match(/the Shelf\)\?/g)?.length, 2, 'the question came twice');
  assert.equal((await settings(home)).shelf, shelf);
});

test('input that ends early stops setup, keeps what finished, and never hangs', async (t) => {
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const nothing = await setupIn(t, home, '');
  assert.equal(nothing.code, 1);
  assert.match(nothing.stderr, /setup ended before it had every answer\./);

  // A bad answer, then the end: the question was asked, refused, and cut off.
  const cut = await setupIn(t, home, answers('relative/path'));
  assert.equal(cut.code, 1);
  assert.match(cut.stderr, /setup ended before it had every answer\./);
  assert.deepEqual(await settings(home), {});

  // The Shelf is answered, then the input ends at the next question.
  const kept = await setupIn(t, home, answers(shelf));
  assert.equal(kept.code, 1);
  assert.match(kept.stderr, /setup ended before it had every answer\./);
  assert.equal((await settings(home)).shelf, shelf, 'the step that finished is kept');
});

test('setup takes nothing on the command line, and the help names it', async (t) => {
  const home = await makeHome(t);

  const extra = await firstmate(home, ['setup', '--shelf', '/tmp']);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /setup takes nothing/);

  const help = await firstmate(home, ['--help']);
  assert.match(help.stdout, /firstmate setup/);
});

test('the Official Plugins chosen are fetched into the Shelf and registered', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t);
  const home = await makeHome(t);
  const shelf = await directory(home, 'plugins');

  const run = await setupIn(t, home, answers(shelf, '1, 3', ''), env);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, / 1\. worklog +keeps what you work on/);
  assert.match(run.stdout, / 2\. scheduler +calls one tool/);
  assert.match(run.stdout, /fetching worklog from https:\/\/github\.com\/luanAfons0\/worklog/);
  assert.ok(run.stdout.includes(`installed nexus at ${join(shelf, 'nexus')}`), run.stdout);
  assert.match(run.stdout, /setup changed:\n.*\n {2}installed worklog\n {2}installed nexus\n/);
  assert.match(run.stdout, /restart the Host to pick it up/);
  assert.deepEqual(
    (await registry(home)).map((row) => [row.name, row.directory]),
    [
      ['worklog', join(shelf, 'worklog')],
      ['nexus', join(shelf, 'nexus')],
    ],
  );

  // A second run shows them as installed, and offers only what is left.
  const again = await setupIn(t, home, answers('', '', ''), env);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /worklog +keeps what you work on.* \(installed\)/);
  assert.match(again.stdout, / 1\. scheduler/);
  assert.doesNotMatch(again.stdout, / 2\./);
  assert.doesNotMatch(again.stdout, /setup changed/);
});

test('a Plugin registered from elsewhere under an official name shows as installed', async (t) => {
  const home = await makeHome(t);
  const elsewhere = await directory(home, 'nexus-clone');
  await firstmate(home, ['add', 'nexus', elsewhere]);

  const run = await setupIn(t, home, answers('', '', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /nexus +manages .* \(installed\)/);
  assert.match(run.stdout, / 2\. scheduler/);
  assert.doesNotMatch(run.stdout, / 3\./);
});

test('Enter installs nothing, and a number off the list is asked again', async (t) => {
  const home = await makeHome(t);

  const run = await setupIn(t, home, answers('', '7', 'two', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, /7 is not on the list\. Type a number from 1 to 3\./);
  assert.match(run.stderr, /two is not on the list\./);
  assert.deepEqual(await registry(home), []);
});

test('a clone that fails names the Plugin, and the others are still installed', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t, ['worklog', 'nexus']);
  const home = await makeHome(t);

  const run = await setupIn(t, home, answers('', '1 2 3', ''), env);

  assert.equal(run.code, 1, 'a step failed, and the exit code says so');
  assert.match(run.stderr, /could not install scheduler: git could not clone/);
  assert.deepEqual(
    (await registry(home)).map((row) => row.name),
    ['worklog', 'nexus'],
  );
});

test('a Plugin that calls others is offered Grants to every other Plugin', async (t) => {
  if (!(await hasGit())) {
    t.skip('this machine has no git to clone with');
    return;
  }
  const env = await officialSources(t);
  const home = await makeHome(t);
  const mine = await directory(home, 'mine');
  await firstmate(home, ['add', 'mine', mine]);

  // Install scheduler and worklog, then let scheduler call mine.
  const run = await setupIn(t, home, answers('', '1 2', '1', ''), env);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /The Plugins scheduler may call:\n {2} 1\. mine\n {2} 2\. worklog\n/);
  assert.match(run.stdout, /granted scheduler the right to call mine's tools/);
  assert.match(run.stdout, / {2}scheduler may call mine\n/);
  const rows = await registry(home);
  assert.deepEqual(rows.find((row) => row.name === 'scheduler')?.grants, ['mine']);
  assert.deepEqual(rows.find((row) => row.name === 'worklog')?.grants, [], 'no Grant for worklog');

  // A second run shows the Grant given, offers the rest, and Enter gives none.
  const again = await setupIn(t, home, answers('', '', '', ''), env);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, / {6}mine \(granted\)\n {2} 1\. worklog\n/);
  assert.deepEqual((await registry(home)).find((row) => row.name === 'scheduler')?.grants, [
    'mine',
  ]);
});

test('setup never takes a Grant back, and asks nothing of a Plugin that calls none', async (t) => {
  const home = await makeHome(t);
  const scheduler = await directory(home, 'scheduler');
  const worklog = await directory(home, 'worklog');
  await firstmate(home, ['add', 'scheduler', scheduler]);
  await firstmate(home, ['add', 'worklog', worklog]);
  await firstmate(home, ['grant', 'scheduler', 'worklog']);

  const run = await setupIn(t, home, answers('', '', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, / {6}worklog \(granted\)\n/);
  assert.doesNotMatch(run.stdout, /Which may scheduler call/, 'every Grant is given already');
  assert.doesNotMatch(run.stdout, /The Plugins worklog may call/);
  assert.deepEqual((await registry(home)).find((row) => row.name === 'scheduler')?.grants, [
    'worklog',
  ]);
});

test('Shortcuts are bound one after another, until Enter at the keys', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'alpha', await directory(home, 'alpha')]);
  await firstmate(home, ['add', 'beta', await directory(home, 'beta')]);
  await firstmate(home, ['bind', 'Ctrl+Alt+A', 'alpha']);

  const run = await setupIn(
    t,
    home,
    answers('', '', 'alt+ctrl+b', '2', 'notes/today', 'Ctrl+Shift+Z', '1', '', ''),
  );

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /The Shortcuts bound now:\n {2}Ctrl\+Alt\+A {2}opens \/p\/alpha\/\n/);
  assert.match(run.stdout, /bound Ctrl\+Alt\+B to open \/p\/beta\/notes\/today/);
  assert.match(
    run.stdout,
    /setup changed:\n {2}bound Ctrl\+Alt\+B to open \/p\/beta\/notes\/today\n/,
  );
  assert.doesNotMatch(run.stdout, /restart the Host/, 'the Tray picks a Shortcut up by itself');
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Ctrl+Alt+A', plugin: 'alpha', path: '' },
    { keys: 'Ctrl+Alt+B', plugin: 'beta', path: 'notes/today' },
    { keys: 'Ctrl+Shift+Z', plugin: 'alpha', path: '' },
  ]);
});

test('keys and paths that bind refuses are refused in its words, and asked again', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'alpha', await directory(home, 'alpha')]);
  await firstmate(home, ['bind', 'Ctrl+Alt+A', 'alpha']);

  const noModifier = await firstmate(home, ['bind', 'N', 'alpha']);
  const held = await firstmate(home, ['bind', 'ctrl+alt+a', 'alpha']);
  const climbs = await firstmate(home, ['bind', 'Ctrl+Alt+B', 'alpha', '../other']);

  const run = await setupIn(
    t,
    home,
    answers('', '', 'N', 'ctrl+alt+a', 'Ctrl+Alt+B', '1', '../other', '', ''),
  );

  assert.equal(run.code, 0, run.stderr);
  assert.equal(
    run.stderr,
    noModifier.stderr + held.stderr + climbs.stderr,
    'one rule, one sentence',
  );
  assert.deepEqual((await settings(home)).shortcuts, [
    { keys: 'Ctrl+Alt+A', plugin: 'alpha', path: '' },
    { keys: 'Ctrl+Alt+B', plugin: 'alpha', path: '' },
  ]);
});

test('Enter at the keys binds nothing, and an empty Registry asks nothing', async (t) => {
  const home = await makeHome(t);

  const empty = await setupIn(t, home, answers('', ''));
  assert.equal(empty.code, 0, empty.stderr);
  assert.doesNotMatch(empty.stdout, /Keys for a new Shortcut/);

  await firstmate(home, ['add', 'alpha', await directory(home, 'alpha')]);
  const none = await setupIn(t, home, answers('', '', ''));
  assert.equal(none.code, 0, none.stderr);
  assert.match(none.stdout, /Keys for a new Shortcut/);
  assert.equal((await settings(home)).shortcuts, undefined);
});

const INACTIVE = { systemctl: [{ when: '--user is-active', code: 3 }] };

/** A Registry where `setup` has one Grant to offer, so it can change the Registry. */
async function schedulerAndWorklog(home: string): Promise<void> {
  await firstmate(home, ['add', 'scheduler', await directory(home, 'scheduler')]);
  await firstmate(home, ['add', 'worklog', await directory(home, 'worklog')]);
}

test('with no systemd, setup says so in the words service uses, and goes on', async (t) => {
  const home = await makeHome(t);
  const alone = await firstmate(home, ['service', 'on'], { PATH: await binWith(t, []) });

  const run = await setupIn(t, home, answers('', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.includes(alone.stderr), 'one sentence, in both places');
  assert.doesNotMatch(run.stdout, /Run the Host as a systemd user service\?/);
});

test('yes to the service installs it as service on does, and needs no restart', async (t) => {
  const m = await machine(t, INACTIVE);
  const home = await makeHome(t);
  await schedulerAndWorklog(home);

  const run = await setupIn(t, home, answers('', '', '1', '', 'y'), m.env);

  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.includes(`installed ${m.unit}`), run.stdout);
  assert.match(await readFile(m.unit, 'utf8'), /^ExecStart=/m);
  const calls = await m.calls();
  assert.ok(calls.includes('systemctl --user enable --now firstmate.service'), calls.join('\n'));
  assert.ok(calls.includes('loginctl enable-linger mate'));
  assert.match(run.stdout, / {2}the Host runs as a systemd user service\n/);
  assert.doesNotMatch(run.stdout, /Restart the Host now/, 'a service that just started is fresh');
  assert.doesNotMatch(run.stdout, /restart the Host to pick it up/);
});

test('no to the service installs nothing', async (t) => {
  const m = await machine(t, INACTIVE);
  const home = await makeHome(t);

  const run = await setupIn(t, home, answers('', '', 'n'), m.env);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /Run the Host as a systemd user service\? \[Y\/n\]/);
  await assert.rejects(readFile(m.unit, 'utf8'), 'no unit is written');
  assert.ok(!(await m.calls()).some((call) => call.includes('enable')));
});

test('a running service is not asked about, and a changed Registry asks to restart', async (t) => {
  const m = await machine(t);
  const home = await makeHome(t);
  await schedulerAndWorklog(home);

  const yes = await setupIn(t, home, answers('', '', '1', '', 'y'), m.env);

  assert.equal(yes.code, 0, yes.stderr);
  assert.doesNotMatch(yes.stdout, /Run the Host as a systemd user service\?/);
  assert.match(yes.stdout, /Restart the Host now, so that it picks the changes up\? \[Y\/n\]/);
  assert.ok((await m.calls()).includes('systemctl --user restart firstmate'));
  assert.match(yes.stdout, / {2}restarted the Host\n/);
});

test('no to the restart prints the command to run later', async (t) => {
  const m = await machine(t);
  const home = await makeHome(t);
  await schedulerAndWorklog(home);

  const no = await setupIn(t, home, answers('', '', '1', '', 'n'), m.env);

  assert.equal(no.code, 0, no.stderr);
  assert.match(no.stdout, /restart it when you are ready: systemctl --user restart firstmate/);
  assert.ok(!(await m.calls()).some((call) => call.includes('restart')));
});

test('a run that changes no Plugin and no Grant does not ask to restart', async (t) => {
  const m = await machine(t);
  const home = await makeHome(t);
  await firstmate(home, ['add', 'alpha', await directory(home, 'alpha')]);

  const run = await setupIn(t, home, answers('', '', 'Ctrl+Alt+A', '1', '', ''), m.env);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /bound Ctrl\+Alt\+A/);
  assert.doesNotMatch(run.stdout, /Restart the Host now/);
  assert.ok(!(await m.calls()).some((call) => call.includes('restart')));
});
