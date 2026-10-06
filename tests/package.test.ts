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
import { readdir, readFile } from 'node:fs/promises';
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
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('LICENSE.md'));
  assert.ok(files.includes('package.json'));
});

test('the package carries core inside the bundle, and depends on nothing', async () => {
  const code = await builtCode();

  // Neither is published, so an import of either would fail on every install.
  for (const [path, text] of code) {
    assert.ok(!text.includes('@firstmate/'), `${path} imports a workspace package`);
    // The prompt library is a devDependency, and the bundle carries it
    // (ADR-0025): what the bundle imports is Node's own, or the bundle's own.
    for (const [, named] of text.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
      assert.match(named ?? '', /^(node:|\.\/)/, `${path} imports ${named}`);
    }
  }
  const manifest = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8')) as {
    dependencies?: Readonly<Record<string, string>>;
  };
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], 'npx pulls nothing else');
});

test('the package holds no Host and no window', async () => {
  const files = await packed;
  const code = await builtCode();

  // The App holds the Host and the window, and the package is the command
  // line alone (ADR-0024). These names belong to the Host's own source.
  assert.ok(!files.includes('dist/main.js'), 'no Host entry point');
  for (const [path, text] of code) {
    assert.ok(!text.includes('@webviewjs/webview'), `${path} loads the window library`);
    for (const host of ['superviseAll', 'openToolBus', 'keepLog', 'startHost']) {
      assert.ok(!text.includes(host), `${path} carries the Host's ${host}`);
    }
  }
  assert.ok(!files.some((file) => file.startsWith('windows/')), 'no logon scripts');
  assert.ok(!files.some((file) => file.startsWith('icons/')), 'no Tray marks');
});

test('the command line reads its own version beside the bundle', async () => {
  const code = await builtCode();

  // firstmate desktop installs the App of its own version, which it reads
  // from the package's manifest, one folder up from the file that reads it.
  const readers = [...code].filter(([, text]) => text.includes('"../package.json"'));
  assert.equal(readers.length, 1, 'one chunk reads the version');
  assert.match(readers[0]?.[0] ?? '', /^dist\/[^/]+\.js$/, 'and it sits directly in dist/');
  assert.ok((await packed).includes('package.json'), 'beside the manifest it reads');
});

test('every package in the workspace carries one version', async () => {
  // One tag releases all of it, the App with the command line, so a bug report
  // can name one number (ADR-0023). A package added later is counted too.
  const versions: Record<string, string | undefined> = {};
  const packages = await Promise.all(
    ['apps', 'packages'].map(async (group) =>
      (await readdir(join(REPOSITORY, group))).map((name) => `${group}/${name}`),
    ),
  );
  for (const where of ['.', ...packages.flat()]) {
    const path = join(REPOSITORY, where, 'package.json');
    versions[where] = (JSON.parse(await readFile(path, 'utf8')) as { version?: string }).version;
  }

  assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
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
