/**
 * `firstmate desktop` installs the App of its own version, and opens it.
 *
 * It downloads the installer and its checksum from the GitHub Release of its
 * version, refuses an installer that does not match, runs the one that does
 * silently, and opens the App; an App of that version, or a newer one, is only
 * opened (ADR-0022). Every test runs against a fake Release and a fake
 * Windows, `tests/helpers/windows.ts`: WSL on Linux, and Windows itself on
 * Windows.
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { firstmate, makeHome } from './helpers/host.ts';
import { fakeWindows } from './helpers/windows.ts';

test('desktop downloads the App of its own version, checks it, installs it and opens it', async (t) => {
  const windows = await fakeWindows(t);
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 0, run.stderr);
  const installer = `FirstMate-Setup-${windows.version}.exe`;
  assert.deepEqual(windows.asked, [
    `/v${windows.version}/${installer}.sha256`,
    `/v${windows.version}/${installer}`,
  ]);
  await windows.until(/^FirstMate\.exe/);
  const calls = await windows.calls();
  assert.ok(calls.includes(`${installer} /S`), 'the installer ran silently, for this user');
  assert.ok(
    calls.indexOf(`${installer} /S`) < calls.findIndex((line) => line.startsWith('FirstMate.exe')),
    'the App opened after it was installed',
  );
  assert.match(run.stdout, new RegExp(`installed FirstMate ${windows.version}, and opened it`));
  assert.deepEqual(await readdir(windows.temp), [], 'the installer is not left behind');
});

test('an installer that does not match its checksum is refused, and nothing runs', async (t) => {
  const windows = await fakeWindows(t, 'wrong checksum');
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 3, 'a value that is not what it must be');
  assert.match(
    run.stderr,
    /^firstmate: the installer from \S+ does not match its published SHA-256, so it was not run\.\n$/,
  );
  const calls = await windows.calls();
  assert.ok(
    !calls.some((line) => line.startsWith('FirstMate-Setup-')),
    'the installer did not run',
  );
  assert.ok(!calls.some((line) => line.startsWith('FirstMate.exe')), 'no App was opened');
  assert.deepEqual(await readdir(windows.temp), [], 'the installer was not even written');
});

test('an App of the same version is only opened', async (t) => {
  const windows = await fakeWindows(t);
  windows.install(windows.version);
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(windows.asked, [], 'nothing was downloaded');
  await windows.until(/^FirstMate\.exe/);
  const calls = await windows.calls();
  assert.ok(!calls.some((line) => line.startsWith('FirstMate-Setup-')), 'no installer ran');
  assert.equal(run.stdout, `firstmate: opened FirstMate ${windows.version}.\n`);
});

test('a newer App is opened and not taken back to this version', async (t) => {
  const windows = await fakeWindows(t);
  windows.install('999.0.0');
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(windows.asked, []);
  await windows.until(/^FirstMate\.exe/);
  assert.match(run.stdout, /opened FirstMate 999\.0\.0, which is newer than this command line/);
});

test('an older App is replaced by this version', async (t) => {
  const windows = await fakeWindows(t);
  windows.install('0.0.1');
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 0, run.stderr);
  assert.ok((await windows.calls()).includes(`FirstMate-Setup-${windows.version}.exe /S`));
  assert.match(run.stdout, new RegExp(`installed FirstMate ${windows.version}`));
});

test('a version with no Release is refused, and nothing runs', async (t) => {
  const windows = await fakeWindows(t, 'none');
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], windows.env);

  assert.equal(run.code, 4, 'a thing that is not there');
  assert.match(run.stderr, new RegExp(`there is no FirstMate ${windows.version} to install`));
  assert.ok(!(await windows.calls()).some((line) => line.startsWith('FirstMate')));
});

test('desktop says where it belongs on a Linux that is not WSL', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('this machine is Windows, or has no WSL to be outside of');
    return;
  }
  const windows = await fakeWindows(t);
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], { ...windows.env, WSL_DISTRO_NAME: '' });

  assert.equal(run.code, 1);
  assert.equal(
    run.stderr,
    'firstmate: the FirstMate App runs on Windows. Run firstmate desktop on Windows, or inside WSL.\n',
  );
  assert.equal(run.stdout, '', 'a refusal is not news');
  assert.deepEqual(await windows.calls(), [], 'it asked Windows nothing');
});

test('desktop takes nothing', async (t) => {
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop', '--distribution', 'Debian']);

  assert.equal(run.code, 2, 'the operator was wrong, not the machine');
  assert.match(run.stderr, /^firstmate: desktop takes nothing\./);
});
