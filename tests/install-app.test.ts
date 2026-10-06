/**
 * `firstmate desktop` installs the App of its own version, and opens it.
 *
 * It downloads the installer and its checksum from the GitHub Release of its
 * version, refuses an installer that does not match, runs the one that does
 * silently, and opens the App; an App of that version, or a newer one, is only
 * opened (ADR-0023). The Windows App's tests run against a fake Release and
 * a fake Windows, `tests/helpers/windows.ts`: WSL on Linux, and Windows itself
 * on Windows. On Linux outside WSL the App is the AppImage, and its tests run
 * against a fake Release and a home of their own, `tests/helpers/linux.ts`.
 */
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import { firstmate, makeHome } from './helpers/host.ts';
import { fakeLinux } from './helpers/linux.ts';
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

const NOT_LINUX = process.platform !== 'linux' && 'the AppImage is the Linux form of the App';

test(
  'on Linux, desktop downloads the AppImage of its own version, checks it, installs it and opens it',
  { skip: NOT_LINUX },
  async (t) => {
    const linux = await fakeLinux(t);
    const home = await makeHome(t);

    const run = await firstmate(home, ['desktop'], linux.env);

    assert.equal(run.code, 0, run.stderr);
    const appImage = `FirstMate-${linux.version}.AppImage`;
    assert.deepEqual(linux.asked, [
      `/v${linux.version}/${appImage}.sha256`,
      `/v${linux.version}/${appImage}`,
    ]);
    assert.equal((await stat(linux.program)).mode & 0o111, 0o111, 'the AppImage is executable');
    await linux.until(new RegExp(`^FirstMate\\.AppImage ${linux.version}`));
    assert.match(
      run.stdout,
      new RegExp(`installed FirstMate ${linux.version} at ${linux.program}, and opened it\\.\\n$`),
    );
    assert.deepEqual(
      await readdir(dirname(linux.program)),
      ['FirstMate.AppImage'],
      'nothing else is left beside it',
    );
  },
);

test(
  'on Linux, an AppImage that does not match its checksum is refused, and nothing runs',
  { skip: NOT_LINUX },
  async (t) => {
    const linux = await fakeLinux(t, 'wrong checksum');
    const home = await makeHome(t);

    const run = await firstmate(home, ['desktop'], linux.env);

    assert.equal(run.code, 3, 'a value that is not what it must be');
    assert.match(
      run.stderr,
      /^firstmate: the AppImage from \S+ does not match its published SHA-256, so it was not run\.\n$/,
    );
    await assert.rejects(stat(dirname(linux.program)), { code: 'ENOENT' }, 'nothing was written');
    assert.deepEqual(await linux.calls(), [], 'no App was opened');
  },
);

test('on Linux, an AppImage of the same version is only opened', { skip: NOT_LINUX }, async (t) => {
  const linux = await fakeLinux(t);
  await linux.install(linux.version);
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], linux.env);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(linux.asked, [], 'nothing was downloaded');
  await linux.until(new RegExp(`^FirstMate\\.AppImage ${linux.version}`));
  assert.equal(run.stdout, `firstmate: opened FirstMate ${linux.version}.\n`);
});

test(
  'on Linux, a newer AppImage is opened and not taken back to this version',
  { skip: NOT_LINUX },
  async (t) => {
    const linux = await fakeLinux(t);
    await linux.install('999.0.0');
    const home = await makeHome(t);

    const run = await firstmate(home, ['desktop'], linux.env);

    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(linux.asked, []);
    await linux.until(/^FirstMate\.AppImage 999\.0\.0/);
    assert.match(run.stdout, /opened FirstMate 999\.0\.0, which is newer than this command line/);
  },
);

test('on Linux, an older AppImage is replaced by this version', { skip: NOT_LINUX }, async (t) => {
  const linux = await fakeLinux(t);
  await linux.install('0.0.1');
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], linux.env);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(linux.asked.length, 2, 'the checksum and the AppImage were downloaded');
  await linux.until(new RegExp(`^FirstMate\\.AppImage ${linux.version}`));
  assert.ok(
    !(await linux.calls()).some((line) => line.startsWith('FirstMate.AppImage 0.0.1')),
    'the older App was not opened',
  );
  assert.match(run.stdout, new RegExp(`installed FirstMate ${linux.version}`));
});

test(
  'on Linux, an AppImage whose version cannot be read is replaced by this version',
  { skip: NOT_LINUX },
  async (t) => {
    const linux = await fakeLinux(t);
    await linux.placeByHand();
    const home = await makeHome(t);

    const run = await firstmate(home, ['desktop'], linux.env);

    assert.equal(run.code, 0, run.stderr);
    assert.equal(linux.asked.length, 2, 'the checksum and the AppImage were downloaded');
    await linux.until(new RegExp(`^FirstMate\\.AppImage ${linux.version}`));
    assert.match(run.stdout, new RegExp(`installed FirstMate ${linux.version}`));
  },
);

test(
  'on Linux, a version with no Release is refused, and nothing runs',
  { skip: NOT_LINUX },
  async (t) => {
    const linux = await fakeLinux(t, 'none');
    const home = await makeHome(t);

    const run = await firstmate(home, ['desktop'], linux.env);

    assert.equal(run.code, 4, 'a thing that is not there');
    assert.match(run.stderr, new RegExp(`there is no FirstMate ${linux.version} to install`));
    await assert.rejects(stat(linux.program), { code: 'ENOENT' }, 'nothing was installed');
    assert.deepEqual(await linux.calls(), [], 'no App was opened');
  },
);

test('desktop takes nothing', async (t) => {
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop', '--distribution', 'Debian']);

  assert.equal(run.code, 2, 'the operator was wrong, not the machine');
  assert.match(run.stderr, /^firstmate: desktop takes nothing\./);
});
