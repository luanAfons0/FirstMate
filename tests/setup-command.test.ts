/**
 * `firstmate setup`, driven as a script drives it: answers piped in, one per
 * line, and nothing checked but what a person can see — the exit code, what
 * was printed, and the files written.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { hasGit, officialSources } from './helpers/git.ts';
import { bootHostIn, firstmate, makeHome, until, type CommandResult } from './helpers/host.ts';
import { pathWith } from './helpers/path.ts';
import { fakeWindows } from './helpers/windows.ts';
import { fakeWsl, holdsFakeWsl, NO_FAKE_WSL, type Wsl } from './helpers/wsl.ts';

/**
 * One run of `setup` on a machine of the test's own: git is on `PATH`, and no
 * Windows program is, so no test here reaches the real Windows. The user's
 * home is a folder of the test's own too, so no test reads the App or the
 * autostart entry of the machine the tests run on.
 */
async function setupIn(
  t: TestContext,
  home: string,
  input: string,
  env: NodeJS.ProcessEnv = {},
  shelfAnswers = 1,
): Promise<CommandResult> {
  // Where a wsl Place can run, on Windows or with a fake wsl.exe, setup also
  // asks for WSL distributions to add, after the Shelf, and Enter there adds
  // none. A test that wants one says so.
  const lines = input.split('\n');
  const asked =
    process.platform === 'win32' || holdsFakeWsl(env)
      ? [...lines.slice(0, shelfAnswers), '', ...lines.slice(shelfAnswers)]
      : lines;
  // No App the machine running the tests has installed is ever found.
  const user = { HOME: join(home, 'user'), XDG_CONFIG_HOME: '', XDG_DATA_DIRS: join(home, 'none') };
  const path = await pathWith(t, ['git']);
  return firstmate(home, ['setup'], { PATH: path, ...user, ...env }, asked.join('\n'));
}

/** A fake WSL, with a `wsl` Place for its Debian, which the Official Plugins run in. */
async function debian(t: TestContext, home: string): Promise<Wsl> {
  const wsl = await fakeWsl(t, ['Debian']);
  const added = await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
  assert.equal(added.code, 0, added.stderr);
  return wsl;
}

/** Where an Official Plugin lands in the Debian Place: its Shelf, inside the distribution. */
const SHELF = '/home/mate/.firstmate/shelf';

async function registry(
  home: string,
): Promise<{ name: string; place: string; directory: string; grants: string[] }[]> {
  try {
    return (
      JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as {
        plugins: { name: string; place: string; directory: string; grants: string[] }[];
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
  const run = await setupIn(t, home, answers('relative/path', shelf, ''), {}, 2);

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
  assert.match(help.stdout, /^ {2}setup {2,}\S/m);
});

test(
  'the Official Plugins chosen are fetched into the Shelf of their Place',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await hasGit())) {
      t.skip('this machine has no git to clone with');
      return;
    }
    const env = await officialSources(t);
    const home = await makeHome(t);
    const wsl = await debian(t, home);

    const run = await setupIn(t, home, answers('', '1, 3', ''), { ...env, ...wsl.env });

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, / 1\. worklog +keeps what you work on/);
    assert.match(run.stdout, / 2\. scheduler +calls one tool/);
    assert.match(run.stdout, /fetching worklog from https:\/\/github\.com\/luanAfons0\/worklog/);
    assert.ok(run.stdout.includes(`installed nexus at ${SHELF}/nexus, in deb`), run.stdout);
    assert.match(run.stdout, /setup changed:\n {2}installed worklog\n {2}installed nexus\n/);
    assert.deepEqual(
      (await registry(home)).map((row) => [row.name, row.place, row.directory]),
      [
        ['worklog', 'deb', `${SHELF}/worklog`],
        ['nexus', 'deb', `${SHELF}/nexus`],
      ],
    );

    // A second run shows them as installed, and offers only what is left.
    const again = await setupIn(t, home, answers('', '', ''), { ...env, ...wsl.env });
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /worklog +keeps what you work on.* \(installed\)/);
    assert.match(again.stdout, / 1\. scheduler/);
    assert.doesNotMatch(again.stdout, / 2\./);
    assert.doesNotMatch(again.stdout, /setup changed/);
  },
);

test('an Official Plugin with no Place to run in is not fetched, and setup says why', async (t) => {
  const home = await makeHome(t);

  const run = await setupIn(t, home, answers('', '1', ''));

  assert.equal(run.code, 1, 'a step failed, and the exit code says so');
  assert.match(
    run.stderr,
    /worklog runs in a wsl Place, and there is none\. Add one, then run setup again\./,
  );
  assert.deepEqual(await registry(home), []);
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

test(
  'a clone that fails names the Plugin, and the others are still installed',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await hasGit())) {
      t.skip('this machine has no git to clone with');
      return;
    }
    const env = await officialSources(t, ['worklog', 'nexus']);
    const home = await makeHome(t);
    const wsl = await debian(t, home);

    const run = await setupIn(t, home, answers('', '1 2 3', ''), { ...env, ...wsl.env });

    assert.equal(run.code, 1, 'a step failed, and the exit code says so');
    assert.match(run.stderr, /could not install scheduler: git could not clone/);
    assert.deepEqual(
      (await registry(home)).map((row) => row.name),
      ['worklog', 'nexus'],
    );
  },
);

test(
  'a Plugin that calls others is offered Grants to every other Plugin',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await hasGit())) {
      t.skip('this machine has no git to clone with');
      return;
    }
    const env = await officialSources(t);
    const home = await makeHome(t);
    const wsl = await debian(t, home);
    const mine = await directory(home, 'mine');
    await firstmate(home, ['add', 'mine', mine]);

    // Install scheduler and worklog, then let scheduler call mine.
    const run = await setupIn(t, home, answers('', '1 2', '1', ''), { ...env, ...wsl.env });

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /The Plugins scheduler may call:\n {2} 1\. mine\n {2} 2\. worklog\n/);
    assert.match(run.stdout, /granted scheduler the right to call mine's tools/);
    assert.match(run.stdout, / {2}scheduler may call mine\n/);
    const rows = await registry(home);
    assert.deepEqual(rows.find((row) => row.name === 'scheduler')?.grants, ['mine']);
    assert.deepEqual(
      rows.find((row) => row.name === 'worklog')?.grants,
      [],
      'no Grant for worklog',
    );

    // A second run shows the Grant given, offers the rest, and Enter gives none.
    const again = await setupIn(t, home, answers('', '', '', ''), { ...env, ...wsl.env });
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, / {6}mine \(granted\)\n {2} 1\. worklog\n/);
    assert.deepEqual((await registry(home)).find((row) => row.name === 'scheduler')?.grants, [
      'mine',
    ]);
  },
);

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

/** A Registry where `setup` has one Grant to offer, so it can change the Registry. */
async function schedulerAndWorklog(home: string): Promise<void> {
  await firstmate(home, ['add', 'scheduler', await directory(home, 'scheduler')]);
  await firstmate(home, ['add', 'worklog', await directory(home, 'worklog')]);
}

test(
  'where a wsl Place can run, setup adds a distribution as a Place',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);

    // Not setupIn: this test types its own answer to the distribution question.
    const run = await firstmate(
      home,
      ['setup'],
      { PATH: await pathWith(t, ['git']), ...wsl.env },
      answers('', 'Nope', 'Debian', '', ''),
    );

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /The Places:\n {2}local {2}\(local\)\n/);
    assert.match(run.stderr, /the distribution Nope did not answer/, 'a refusal asks again');
    assert.match(run.stdout, /added the wsl Place debian/);
    const places = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')).places;
    assert.deepEqual(
      places.map((place: { name: string; distribution: string }) => [
        place.name,
        place.distribution,
      ]),
      [['debian', 'Debian']],
    );
  },
);

test(
  'setup offers to import a 1.x install, and imports it on yes',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await debian(t, home);
    const oneX = join(wsl.root, wsl.home, '.firstmate');
    await mkdir(oneX, { recursive: true });
    await writeFile(
      join(oneX, 'registry.json'),
      JSON.stringify({
        plugins: [{ name: 'worklog', directory: '/home/mate/.worklog', grants: [] }],
      }),
    );

    const run = await setupIn(t, home, answers('', 'y', '', ''), wsl.env);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /deb holds a 1\.x install\. Import it\? \[Y\/n\]/);
    assert.match(run.stdout, /imported worklog at \/home\/mate\/\.worklog, in deb/);
    assert.match(run.stdout, / {2}imported 1 Plugin\(s\) from deb\n/);

    const again = await setupIn(t, home, answers('', '', ''), wsl.env);
    assert.doesNotMatch(
      again.stdout,
      /holds a 1\.x install/,
      'a Place with Plugins is not asked again',
    );
  },
);

test(
  'with the App installed, setup asks whether it starts at logon',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const windows = await fakeWindows(t);
    windows.install(windows.version);
    const env = { ...windows.env, PATH: `${windows.env['PATH']}:${process.env['PATH']}` };

    const no = await setupIn(t, home, answers('', '', 'n'), env);
    assert.equal(no.code, 0, no.stderr);
    assert.match(no.stdout, /Start FirstMate at logon\? \[y\/N\]/);
    assert.ok(!(await windows.calls()).some((call) => call.startsWith('reg.exe add')));

    const yes = await setupIn(t, home, answers('', '', 'y'), env);
    assert.equal(yes.code, 0, yes.stderr);
    assert.match(yes.stdout, / {2}FirstMate starts at logon\n/);
    const added = (await windows.calls()).find((call) => call.startsWith('reg.exe add'));
    assert.match(
      added ?? '',
      /^reg\.exe add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run \/v FirstMate \/t REG_SZ \/d "C:\\.*\\FirstMate\.exe" --at-logon \/f$/,
    );

    const once = await setupIn(t, home, answers('', '', ''), env);
    assert.doesNotMatch(once.stdout, /Start FirstMate at logon/, 'it is on, so it is not asked');
  },
);

test('with no App installed, setup says how to install it', { skip: NO_FAKE_WSL }, async (t) => {
  const home = await makeHome(t);
  const windows = await fakeWindows(t);
  const env = { ...windows.env, PATH: `${windows.env['PATH']}:${process.env['PATH']}` };

  const run = await setupIn(t, home, answers('', '', ''), env);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /the App is not installed yet\. Run firstmate desktop to install it\./);
  assert.doesNotMatch(run.stdout, /Start FirstMate at logon/);
});

/** The App on Linux, as `firstmate desktop` installs it: one AppImage in the user's home. */
async function installAppImage(user: string): Promise<string> {
  const program = join(user, 'Applications', 'FirstMate.AppImage');
  await mkdir(join(user, 'Applications'), { recursive: true });
  await writeFile(program, '#!/bin/sh\n', { mode: 0o755 });
  return program;
}

test(
  'on Linux, setup turns start at logon on with an autostart entry',
  { skip: process.platform !== 'linux' && 'the autostart entry is the Linux form of it' },
  async (t) => {
    const home = await makeHome(t);
    const user = join(home, 'a mate');
    const program = await installAppImage(user);
    const env = { HOME: user, XDG_CONFIG_HOME: join(user, 'config') };
    const entry = join(user, 'config', 'autostart', 'firstmate.desktop');

    const no = await setupIn(t, home, answers('', '', 'n'), env);
    assert.equal(no.code, 0, no.stderr);
    assert.match(no.stdout, /Start FirstMate at logon\? \[y\/N\]/);
    await assert.rejects(readFile(entry), { code: 'ENOENT' }, 'answered no, there is no entry');

    const yes = await setupIn(t, home, answers('', '', 'y'), env);
    assert.equal(yes.code, 0, yes.stderr);
    assert.match(yes.stdout, / {2}FirstMate starts at logon\n/);
    const written = await readFile(entry, 'utf8');
    assert.match(written, /^\[Desktop Entry\]$/m);
    assert.match(written, /^Type=Application$/m);
    assert.ok(
      written.split('\n').includes(`Exec="${program}" --at-logon`),
      `the entry starts the AppImage with --at-logon:\n${written}`,
    );

    const once = await setupIn(t, home, answers('', '', ''), env);
    assert.equal(once.code, 0, once.stderr);
    assert.doesNotMatch(once.stdout, /Start FirstMate at logon/, 'it is on, so it is not asked');
  },
);

test(
  'on Linux, with the deb installed and no AppImage, the autostart entry starts the deb',
  { skip: process.platform !== 'linux' && 'the deb is the Linux form of the App' },
  async (t) => {
    const home = await makeHome(t);
    const user = join(home, 'a mate');
    // The deb installs its program under /opt and its desktop entry in the
    // system's applications folder, where the desktop finds it.
    const system = join(home, 'share');
    const program = join(home, 'opt', 'FirstMate', 'firstmate-app');
    await mkdir(dirname(program), { recursive: true });
    await writeFile(program, '#!/bin/sh\n', { mode: 0o755 });
    await mkdir(join(system, 'applications'), { recursive: true });
    await writeFile(
      join(system, 'applications', 'firstmate.desktop'),
      `[Desktop Entry]\nName=FirstMate\nExec=${program} %U\nType=Application\n`,
    );
    const env = { HOME: user, XDG_CONFIG_HOME: join(user, 'config'), XDG_DATA_DIRS: system };

    const run = await setupIn(t, home, answers('', '', 'y'), env);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, / {2}FirstMate starts at logon\n/);
    const written = await readFile(join(user, 'config', 'autostart', 'firstmate.desktop'), 'utf8');
    assert.ok(
      written.split('\n').includes(`Exec="${program}" --at-logon`),
      `the entry starts the deb's program with --at-logon:\n${written}`,
    );
  },
);

test(
  'on Linux, with no App installed, setup says how to install it',
  { skip: process.platform !== 'linux' && 'the AppImage is the Linux form of the App' },
  async (t) => {
    const home = await makeHome(t);

    const run = await setupIn(t, home, answers('', '', ''));

    assert.equal(run.code, 0, run.stderr);
    assert.match(
      run.stdout,
      /the App is not installed yet\. Run firstmate desktop to install it\./,
    );
    assert.doesNotMatch(run.stdout, /Start FirstMate at logon/);
  },
);

test('a run that changes the Registry reloads the running Host, and asks nothing', async (t) => {
  const home = await makeHome(t);
  await schedulerAndWorklog(home);
  const host = await bootHostIn(t, home);

  const run = await setupIn(t, home, answers('', '', '1', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Restart the Host/);
  assert.match(run.stdout, / {2}scheduler may call worklog\n/);
  await until(host, /reloaded 2 Plugin\(s\)/);
});

test('setup never asks to restart the Host', async (t) => {
  const home = await makeHome(t);
  await firstmate(home, ['add', 'alpha', await directory(home, 'alpha')]);

  const run = await setupIn(t, home, answers('', '', 'Ctrl+Alt+A', '1', '', ''));

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /bound Ctrl\+Alt\+A/);
  assert.doesNotMatch(run.stdout, /Restart the Host now/);
});

test(
  'inside WSL on Linux, setup offers no distribution, for a wsl Place runs on Windows only',
  { skip: process.platform === 'win32' && 'Windows offers one' },
  async (t) => {
    const home = await makeHome(t);

    const run = await setupIn(t, home, answers('', ''), { WSL_DISTRO_NAME: 'Debian' });

    assert.equal(run.code, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /The Places:/);
  },
);
