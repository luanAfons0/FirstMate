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
 *
 * In 2.0 `firstmate desktop` installs the App instead, and no command loads
 * the library (`install-app.test.ts`). These tests hold until #145 takes the
 * library and the 1.x window out of the package.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

/** A process where the webview library cannot be resolved at all. */
const NO_WEBVIEW = { NODE_OPTIONS: '--import=./tests/helpers/no-webview.ts' };

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
