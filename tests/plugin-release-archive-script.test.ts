/**
 * The archive script, run alone as the workflow runs it (the hostile archives
 * that `install` refuses are in `plugin-release-archive.test.ts`). It refuses what `install` refuses (ADR-0033). The release
 * workflow publishes whatever the script writes, so a folder that every
 * install would refuse must stop here, before an archive is written, in one
 * sentence that names the path. Each test runs the script as the workflow
 * does and checks its exit, its sentence and that nothing was written. The
 * rules are the ones of `readTar` in `packages/core/src/tar.ts`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeHome } from './helpers/host.ts';

const ARCHIVE_SCRIPT = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'scripts',
  'plugin-release-archive.ts',
);

/** A link needs a privilege on Windows, and a name there cannot hold these characters. */
const NO_LINKS = process.platform === 'win32' ? 'a link needs a privilege on Windows' : false;
const NO_ODD_NAMES = process.platform === 'win32' ? 'Windows cannot hold such a name' : false;

/** Run the archive script on a folder, and list what it wrote into its out folder. */
async function archive(
  t: test.TestContext,
  setup: (folder: string) => Promise<void>,
): Promise<{ code: number | null; stderr: string; written: string[] }> {
  const home = await makeHome(t);
  const folder = join(home, 'release');
  const out = join(home, 'out');
  await mkdir(folder);
  await setup(folder);
  const ran = await new Promise<{ code: number | null; stderr: string }>((done, fail) => {
    const child = spawn(process.execPath, [ARCHIVE_SCRIPT, folder, 'both', '1.0.0', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', fail);
    child.once('close', (code) => done({ code, stderr }));
  });
  const written = await readdir(out).catch(() => []);
  return { ...ran, written };
}

/** The script refused in one sentence that names the path, and wrote nothing. */
function assertRefused(
  ran: { code: number | null; stderr: string; written: string[] },
  path: string,
): void {
  assert.notEqual(ran.code, 0, 'the script refuses');
  assert.ok(ran.stderr.includes(path), ran.stderr);
  assert.equal(ran.stderr.trim().split('\n').length, 1, 'one sentence');
  assert.deepEqual(ran.written, [], 'no archive');
}

test('two names that differ only in case are refused', async (t) => {
  const ran = await archive(t, async (folder) => {
    await writeFile(join(folder, 'README'), 'a');
    await writeFile(join(folder, 'readme'), 'b');
  });
  // A case-insensitive disk holds one file, and the folder is then fine.
  if (ran.code === 0) return t.skip('this disk does not tell names apart by case');
  assertRefused(ran, 'readme');
});

test(
  'two names that differ only in trailing dots are refused',
  { skip: NO_ODD_NAMES },
  async (t) => {
    const ran = await archive(t, async (folder) => {
      await writeFile(join(folder, 'notes'), 'a');
      await writeFile(join(folder, 'notes.'), 'b');
    });
    assertRefused(ran, 'notes.');
  },
);

test('a name made of only dots is refused', { skip: NO_ODD_NAMES }, async (t) => {
  const ran = await archive(t, (folder) => writeFile(join(folder, '...'), 'a'));
  assertRefused(ran, '...');
});

test('a name with a backslash is refused', { skip: NO_ODD_NAMES }, async (t) => {
  const ran = await archive(t, (folder) => writeFile(join(folder, 'a\\b'), 'a'));
  assertRefused(ran, 'a\\b');
});

test('a name with a control character is refused', { skip: NO_ODD_NAMES }, async (t) => {
  const ran = await archive(t, (folder) => writeFile(join(folder, 'a\tb'), 'a'));
  assert.notEqual(ran.code, 0);
  assert.equal(ran.stderr.trim().split('\n').length, 1, 'one sentence');
  assert.deepEqual(ran.written, []);
});

test('a file named .firstmate-release.json in any case is refused', async (t) => {
  const ran = await archive(t, (folder) =>
    writeFile(join(folder, '.FirstMate-Release.json'), '{}'),
  );
  assertRefused(ran, '.FirstMate-Release.json');
});

test('a link to an absolute path is refused', { skip: NO_LINKS }, async (t) => {
  const ran = await archive(t, async (folder) => {
    await writeFile(join(folder, 'mcp'), 'a');
    await symlink('/usr/bin/node', join(folder, 'node'));
  });
  assertRefused(ran, 'node');
});

test('a link that climbs out of the folder is refused', { skip: NO_LINKS }, async (t) => {
  const ran = await archive(t, (folder) => symlink('../outside', join(folder, 'out')));
  assertRefused(ran, 'out');
});

test('a link that climbs through another link is refused', { skip: NO_LINKS }, async (t) => {
  const ran = await archive(t, async (folder) => {
    await symlink('.', join(folder, 'here'));
    await symlink('here/..', join(folder, 'up'));
  });
  assertRefused(ran, 'up');
});

test('a link to a short name or a stream is refused', { skip: NO_LINKS }, async (t) => {
  const short = await archive(t, async (folder) => {
    await writeFile(join(folder, 'mcp'), 'a');
    await symlink('PROGRA~1', join(folder, 'short'));
  });
  const stream = await archive(t, async (folder) => {
    await writeFile(join(folder, 'mcp'), 'a');
    await symlink('mcp:stream', join(folder, 'streamed'));
  });
  assertRefused(short, 'short');
  assertRefused(stream, 'streamed');
});

test('a link that stays inside the folder is kept', { skip: NO_LINKS }, async (t) => {
  const ran = await archive(t, async (folder) => {
    await writeFile(join(folder, 'mcp'), 'a');
    await symlink('mcp', join(folder, 'alias'));
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.written.length, 2);
});
