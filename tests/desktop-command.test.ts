/**
 * The one command with a dependency, and every command without one.
 *
 * FirstMate's window is drawn by a library with a native binary, and that is
 * the only dependency this project has (ADR-0011). The whole of the bargain is
 * that the Host never pays for it: the library is imported when the desktop
 * subcommand runs and at no other moment, so a machine where the binary is
 * missing, or will not load for want of system libraries, still runs every
 * other command.
 *
 * `tests/helpers/no-webview.ts` is that machine, made on purpose.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

/** A process where the webview library cannot be resolved at all. */
const NO_WEBVIEW = { NODE_OPTIONS: '--import=./tests/helpers/no-webview.ts' };

/** A Linux process with nowhere to draw: no display of either kind. */
const NO_DISPLAY = { DISPLAY: '', WAYLAND_DISPLAY: '' };

test('every other command works where the webview library will not load', async (t) => {
  const home = await makeHome(t);

  const runs: readonly (readonly string[])[] = [
    ['add', 'both', fixture('both')],
    ['add', 'page-only', fixture('page-only')],
    ['grant', 'both', 'page-only'],
    ['list'],
    ['revoke', 'both', 'page-only'],
    ['remove', 'page-only'],
    ['--help'],
  ];

  for (const argv of runs) {
    const run = await firstmate(home, argv, NO_WEBVIEW);
    assert.equal(run.code, 0, `${argv.join(' ')} said: ${run.stderr}`);
    assert.ok(!run.stderr.includes('webview'), `${argv.join(' ')} went looking for the library`);
  }
});

test('the Host starts where the webview library will not load', async (t) => {
  const home = await makeHome(t);

  // `firstmate start` is the command that shares this file with `desktop`, so
  // it is the one most able to drag the library in behind it. The Host
  // listening and serving its own page is the whole assertion.
  const host = await bootHostIn(t, home, NO_WEBVIEW, { viaCommandLine: true });

  assert.equal((await host.fetch('/')).status, 200);
});

test('the window says where it belongs where there is no desktop', async (t) => {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    t.skip('this machine has a desktop');
    return;
  }
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop'], NO_DISPLAY);

  assert.equal(run.code, 1);
  assert.match(run.stderr, /needs a desktop/);
  assert.match(run.stderr, /Windows/, 'the sentence says where it belongs');
  assert.equal(run.stdout, '', 'a refusal is not news');
});

test('the window refuses an option it does not take', async (t) => {
  const home = await makeHome(t);

  const run = await firstmate(home, ['desktop', '--port', '4747']);

  assert.equal(run.code, 2, 'the operator was wrong, not the machine');
  assert.match(run.stderr, /--distribution/);
  assert.match(run.stderr, /--home/);
});
