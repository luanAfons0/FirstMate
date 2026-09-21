/**
 * What a stranger downloads.
 *
 * Packing reads the working directory rather than git, so a directory that is
 * untracked but not ignored is packed all the same. That is how a whole second
 * copy of the repository once reached the package. This test is the guard: it
 * packs for real and reads the list back.
 *
 * It needs no network. `npm pack --dry-run` builds the package through
 * `prepack` and reports what it would write, which is also how this test
 * proves that packing always builds (ADR-0010).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every path packing would write, as npm itself reports them. */
function packedFiles(): Promise<readonly string[]> {
  return new Promise((done, fail) => {
    const child = spawn('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPOSITORY,
      env: { ...process.env, npm_config_loglevel: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', fail);
    child.once('exit', (code) => {
      if (code !== 0) return fail(new Error(`npm pack exited ${code}\n${stderr}`));
      const reported = JSON.parse(stdout) as
        | { files: { path: string }[] }[]
        | { files: { path: string }[] };
      const one = Array.isArray(reported) ? reported[0] : reported;
      done((one?.files ?? []).map((file) => file.path));
    });
  });
}

test('the package holds the built output, the README and the licence', async () => {
  const files = await packedFiles();

  assert.ok(files.includes('dist/cli.js'), 'the command line, built');
  assert.ok(files.includes('dist/main.js'), 'the Host, built');
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('LICENSE.md'));

  // Packing builds, so the package can never be stale against the source.
  const built = files.filter((path) => path.startsWith('dist/') && path.endsWith('.js'));
  assert.ok(built.length >= 15, `every source file is built, got ${built.length}`);
});

test('the package holds the desktop program and the icons it draws with', async () => {
  const files = await packedFiles();

  assert.ok(files.includes('dist/desktop.js'), 'the part that shows');
  assert.ok(files.includes('dist/desktop-state.js'), 'the part that decides');
  // The Tray cannot draw without them, and tsc copies nothing that is not
  // TypeScript, so they are packed from where they live rather than built.
  assert.ok(files.includes('icons/firstmate-running.ico'));
  assert.ok(files.includes('icons/firstmate-stopped.ico'));
});

test('the package holds nothing a stranger has no use for', async () => {
  const files = await packedFiles();

  const unwanted: Readonly<Record<string, RegExp>> = {
    'a test': /^tests\//,
    'a fixture': /fixtures\//,
    'the PowerShell': /\.ps1$|^windows\//,
    'the systemd unit': /^systemd\/|\.service$/,
    'the documentation': /^docs\//,
    'an agent worktree': /^\.claude\//,
    'the source': /^src\//,
    'a workflow': /^\.github\//,
  };

  for (const [what, pattern] of Object.entries(unwanted)) {
    const found = files.filter((path) => pattern.test(path));
    assert.deepEqual(found, [], `${what} is packed`);
  }
});
