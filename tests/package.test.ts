/**
 * What a stranger downloads.
 *
 * Packing reads the working directory rather than git, so a directory that is
 * untracked but not ignored is packed all the same. That is how a whole second
 * copy of the repository once reached the package. This test is the guard: it
 * packs for real and reads the list back.
 *
 * It needs no network. `pnpm pack --dry-run` builds the package through
 * `prepack` and reports what it would write, which is also how this test
 * proves that packing always builds (ADR-0017). The package is `apps/cli`, and
 * `core` and `host` reach it only inside the bundle.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { pnpm } from './helpers/host.ts';

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));

/** The published package: the command line, which carries the Host. */
const PACKAGE = join(REPOSITORY, 'apps', 'cli');

/** Every path packing would write, as pnpm itself reports them. */
function pack(): Promise<readonly string[]> {
  return new Promise((done, fail) => {
    const child = pnpm(['pack', '--dry-run', '--json'], {
      cwd: PACKAGE,
      env: { ...process.env, npm_config_loglevel: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', fail);
    child.once('exit', (code) => {
      if (code !== 0) return fail(new Error(`pnpm pack exited ${code}\n${stderr}`));
      try {
        const reported = JSON.parse(stdout) as
          { files: { path: string }[] }[] | { files: { path: string }[] };
        const one = Array.isArray(reported) ? reported[0] : reported;
        done((one?.files ?? []).map((file) => file.path));
      } catch {
        // Thrown here, it would never reach the tests that wait on it.
        fail(new Error(`pnpm pack printed something other than its report:\n${stdout}`));
      }
    });
  });
}

// Packing builds, and a build empties dist/ first, so it happens once here
// rather than once a test.
const packed = pack();

/** The built JavaScript the package holds, file by file. */
async function builtCode(): Promise<ReadonlyMap<string, string>> {
  const files = (await packed).filter((path) => path.startsWith('dist/') && path.endsWith('.js'));
  const code = await Promise.all(files.map((path) => readFile(join(PACKAGE, path), 'utf8')));
  return new Map(files.map((path, at) => [path, code[at] ?? '']));
}

test('the package holds the built output, the README and the licence', async () => {
  const files = await packed;

  assert.ok(files.includes('dist/cli.js'), 'the command line, built');
  assert.ok(files.includes('dist/main.js'), 'the Host, built, beside it');
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('LICENSE.md'));
  assert.ok(files.includes('package.json'));
});

test('the package carries core and host inside the bundle', async () => {
  const code = await builtCode();

  // Neither is published, so an import of either would fail on every install.
  for (const [path, text] of code) {
    assert.ok(!text.includes('@firstmate/'), `${path} imports a workspace package`);
  }
  const manifest = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8')) as {
    dependencies?: Readonly<Record<string, string>>;
  };
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ['@webviewjs/webview']);
});

test('the package holds the desktop program and the icons it draws with', async () => {
  const files = await packed;
  const code = await builtCode();

  // The window library is imported where the window opens and nowhere else,
  // so every other command runs where its native binary will not (ADR-0011).
  const importers = [...code].filter(([, text]) => text.includes('@webviewjs/webview'));
  assert.equal(importers.length, 1, 'one chunk holds the window');
  const [path = '', text = ''] = importers[0] ?? [];
  assert.ok(text.includes('import("@webviewjs/webview")'), 'it is a dynamic import');
  assert.ok(!/^import .*@webviewjs\/webview/m.test(text), 'it is not a static import');
  assert.notEqual(path, 'dist/cli.js', 'the command line does not load it');
  assert.notEqual(path, 'dist/main.js', 'the Host does not load it');

  // The Tray cannot draw without them, and the bundler copies nothing that is
  // not code, so they are packed from where they live rather than built.
  assert.ok(files.includes('icons/firstmate-running.ico'));
  assert.ok(files.includes('icons/firstmate-stopped.ico'));
});

test('every package in the workspace carries one version', async () => {
  // One tag publishes all of it, so a bug report can name one number.
  const versions: Record<string, string | undefined> = {};
  for (const where of ['.', 'apps/cli', 'packages/core', 'packages/host']) {
    const path = join(REPOSITORY, where, 'package.json');
    versions[where] = (JSON.parse(await readFile(path, 'utf8')) as { version?: string }).version;
  }

  assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});

test('the package holds the Windows logon task, so an npm install can hold WSL up', async () => {
  const files = await packed;

  // `firstmate service on` prints the command that runs these from where the
  // package is, so they have to be there.
  for (const file of [
    'install-logon-task.ps1',
    'uninstall-logon-task.ps1',
    'hold-distribution.ps1',
    'firstmate-hidden.vbs',
  ]) {
    assert.ok(files.includes(`windows/${file}`), file);
  }
});

test('the package holds nothing a stranger has no use for', async () => {
  const files = await packed;

  const unwanted: Readonly<Record<string, RegExp>> = {
    'a test': /^tests\//,
    'a fixture': /fixtures\//,
    'the systemd unit': /^systemd\/|\.service$/,
    'a shell script': /^scripts\/|\.sh$/,
    'the documentation': /^docs\//,
    'an agent worktree': /^\.claude\//,
    'the source': /^src\/|\.ts$/,
    'a workflow': /^\.github\//,
    'a workspace package': /^packages\/|node_modules\//,
  };

  for (const [what, pattern] of Object.entries(unwanted)) {
    const found = files.filter((path) => pattern.test(path));
    assert.deepEqual(found, [], `${what} is packed`);
  }
});
