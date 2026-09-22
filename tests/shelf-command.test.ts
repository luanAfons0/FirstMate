/** The Shelf: said and moved from a terminal, and read by the Host. */
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome } from './helpers/host.ts';

/** The settings file, read back exactly as the Host would read it. */
async function settings(home: string): Promise<{ shelf?: string }> {
  return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as { shelf?: string };
}

/** A directory that is really there, under a home this test owns. */
async function directory(home: string, name: string): Promise<string> {
  const made = join(home, name);
  await mkdir(made);
  return realpath(made);
}

test('the Shelf is a directory under the home until one is chosen', async (t) => {
  const home = await makeHome(t);

  const said = await firstmate(home, ['shelf']);

  assert.equal(said.code, 0, said.stderr);
  assert.equal(said.stdout, `firstmate: the Shelf is ${join(home, 'shelf')}\n`);
  // Nothing chosen is not an error, and writes no settings file.
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');
});

test('a Shelf is remembered, and what is remembered is the real path', async (t) => {
  const home = await makeHome(t);
  const real = await directory(home, 'plugins');
  const byAnotherName = join(home, 'by-another-name');
  await symlink(real, byAnotherName);

  const moved = await firstmate(home, ['shelf', byAnotherName]);

  assert.equal(moved.code, 0, moved.stderr);
  assert.ok(moved.stdout.includes(`the Shelf is now ${real}`), moved.stdout);
  assert.match(moved.stdout, /restart the Host/);
  assert.deepEqual(await settings(home), { shelf: real });

  const said = await firstmate(home, ['shelf']);
  assert.equal(said.stdout, `firstmate: the Shelf is ${real}\n`);
});

test('the Shelf a terminal chose survives a restart of the Host', async (t) => {
  const home = await makeHome(t);
  const chosen = await directory(home, 'plugins');
  await firstmate(home, ['shelf', chosen]);

  await t.test('the Host reads it', async (first) => {
    const host = await bootHostIn(first, home);
    assert.ok(host.output().includes(`the Shelf is ${chosen}`), host.output());
  });

  // The seam finds a Host by the runtime file the last one left behind.
  await rm(join(home, 'runtime.json'), { force: true });

  await t.test('and the Host started after it reads it too', async (second) => {
    const host = await bootHostIn(second, home);
    assert.ok(host.output().includes(`the Shelf is ${chosen}`), host.output());
  });
});

test('the environment beats the settings file, in a terminal and in the Host', async (t) => {
  const home = await makeHome(t);
  const chosen = await directory(home, 'chosen');
  const forced = await directory(home, 'forced');
  await firstmate(home, ['shelf', chosen]);

  const said = await firstmate(home, ['shelf'], { FIRSTMATE_SHELF: forced });
  assert.equal(said.stdout, `firstmate: the Shelf is ${forced}\n`);

  const host = await bootHostIn(t, home, { FIRSTMATE_SHELF: forced });
  assert.ok(host.output().includes(`the Shelf is ${forced}`), host.output());

  assert.deepEqual(await settings(home), { shelf: chosen }, 'the settings file is untouched');
});

test('choosing a Shelf while the environment holds one says which one wins', async (t) => {
  const home = await makeHome(t);
  const chosen = await directory(home, 'chosen');
  const forced = await directory(home, 'forced');

  const moved = await firstmate(home, ['shelf', chosen], { FIRSTMATE_SHELF: forced });

  assert.equal(moved.code, 0, moved.stderr);
  assert.ok(moved.stdout.includes(`FIRSTMATE_SHELF is set to ${forced}`), moved.stdout);
  assert.deepEqual(await settings(home), { shelf: chosen }, 'the choice is still remembered');
});

test('a damaged settings file fails loudly', async (t) => {
  const home = await makeHome(t);

  await writeFile(join(home, 'settings.json'), 'not JSON at all');
  const broken = await firstmate(home, ['shelf']);
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /are not valid JSON/);

  await writeFile(join(home, 'settings.json'), '{"shelf": 7}\n');
  const wrong = await firstmate(home, ['shelf']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /needs? "shelf" to be a path/);
});

test('the settings file is written whole, and kept to this user alone', async (t) => {
  const home = await makeHome(t);
  const chosen = await directory(home, 'plugins');

  await firstmate(home, ['shelf', chosen]);

  const written = await stat(join(home, 'settings.json'));
  assert.equal(written.mode & 0o777, 0o600, 'as private as the Registry');
  assert.equal(
    await readFile(join(home, 'settings.json'), 'utf8'),
    `${JSON.stringify({ shelf: chosen }, null, 2)}\n`,
  );
  await assert.rejects(stat(join(home, 'settings.json.pending')), 'nothing is left half written');
});

test('a relative path is refused, and the Shelf does not move', async (t) => {
  const home = await makeHome(t);
  const chosen = await directory(home, 'plugins');
  await firstmate(home, ['shelf', chosen]);

  const refused = await firstmate(home, ['shelf', 'plugins']);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /is not an absolute path/);
  assert.deepEqual(await settings(home), { shelf: chosen }, 'the Shelf did not move');
});

test('a symlink leading to the Host home directory is refused', async (t) => {
  const home = await makeHome(t);
  const elsewhere = await makeHome(t);
  const looksHarmless = join(elsewhere, 'looks-harmless');
  await symlink(home, looksHarmless);

  const refused = await firstmate(home, ['shelf', looksHarmless]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /is the Host's own home directory/);
  await assert.rejects(readFile(join(home, 'settings.json')), 'nothing was written');
});

test('a path spelled with .. that climbs above the home is refused', async (t) => {
  const home = await makeHome(t);

  // The `..` is collapsed before the path is judged, so what is judged is the
  // parent of the home rather than a directory named `..` under it.
  const climbing = `${home}/plugins/../..`;
  const refused = await firstmate(home, ['shelf', climbing]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /holds the Host's own home directory/);
});

test('a path that is a file, and a path that is not there, each say so', async (t) => {
  const home = await makeHome(t);

  const file = await firstmate(home, ['shelf', join(fixture('both'), 'mcp')]);
  assert.equal(file.code, 1);
  assert.match(file.stderr, /is a file, not a directory/);

  const missing = await firstmate(home, ['shelf', '/no/such/place']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /does not exist\. Create it/);
});

test('a Windows path is refused with the WSL path it names', async (t) => {
  const home = await makeHome(t);

  const drive = await firstmate(home, ['shelf', 'C:\\Users\\me\\Plugins']);
  assert.equal(drive.code, 1);
  assert.match(drive.stderr, /is a Windows path/);
  assert.ok(drive.stderr.includes('/mnt/c/Users/me/Plugins'), drive.stderr);

  const unc = await firstmate(home, ['shelf', '\\\\wsl.localhost\\Debian\\home\\me\\plugins']);
  assert.equal(unc.code, 1);
  assert.ok(unc.stderr.includes('/home/me/plugins'), unc.stderr);
});

test('a directory this user cannot write to is refused', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root writes anywhere, so there is nothing here to refuse');
    return;
  }
  const home = await makeHome(t);
  const shut = await directory(home, 'shut');
  await chmod(shut, 0o500);

  const refused = await firstmate(home, ['shelf', shut]);

  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /cannot be written to by this user/);
});

test('a directory inside the Host home directory is allowed', async (t) => {
  const home = await makeHome(t);
  const inside = await directory(home, 'shelf');

  const moved = await firstmate(home, ['shelf', inside]);

  assert.equal(moved.code, 0, moved.stderr);
  assert.ok(moved.stdout.includes(`the Shelf is now ${inside}`), moved.stdout);
});

test('shelf takes one directory, or nothing', async (t) => {
  const home = await makeHome(t);

  const tooMany = await firstmate(home, ['shelf', '/one', '/two']);

  assert.equal(tooMany.code, 2, 'the wrong shape of invocation, not a refusal');
  assert.match(tooMany.stderr, /shelf takes one directory, or nothing/);
});
