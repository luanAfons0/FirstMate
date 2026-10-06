/**
 * The App keeps the operator's answer when a Plugin Page asks for the
 * microphone or a capture of the screen, in the settings file. The App's
 * dialog has no test (ADR-0020); what a terminal sees of the answers does: a
 * command that writes the settings keeps them, and a damaged one fails loudly.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { firstmate, fixture, makeHome } from './helpers/host.ts';

/** A home with the fixture Plugin `both`, and these settings. */
async function homeWith(t: Parameters<typeof makeHome>[0], settings: unknown): Promise<string> {
  const home = await makeHome(t);
  const added = await firstmate(home, ['add', 'both', fixture('both')]);
  assert.equal(added.code, 0, added.stderr);
  await writeFile(join(home, 'settings.json'), `${JSON.stringify(settings)}\n`);
  return home;
}

test('a command that writes the settings keeps the permission answers', async (t) => {
  const permissions = { both: { microphone: true, capture: false } };
  const home = await homeWith(t, { permissions });

  const bound = await firstmate(home, ['bind', 'Ctrl+Alt+F9', 'both']);

  assert.equal(bound.code, 0, bound.stderr);
  const written = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as {
    permissions?: unknown;
  };
  assert.deepEqual(written.permissions, permissions);
});

test('a damaged permission answer fails every command loudly', async (t) => {
  const damage: [unknown, RegExp][] = [
    [['both'], /need "permissions" to be a JSON object/],
    [{ 'Not A Name': { microphone: true } }, /need to be kept under a Plugin Name/],
    [{ both: true }, /The permissions of "both" .* need to be a JSON object/],
    [{ both: { camera: true } }, /may hold only "microphone" and "capture".*"camera"/],
    [{ both: { microphone: 'yes' } }, /each true or false.*"microphone": "yes"/],
  ];

  for (const [permissions, said] of damage) {
    const home = await homeWith(t, { permissions });
    for (const argv of [['list'], ['bind', 'Ctrl+Alt+F9', 'both']]) {
      const broken = await firstmate(home, argv);
      assert.equal(broken.code, 1, argv.join(' '));
      assert.match(broken.stderr, said);
      assert.match(broken.stderr, /settings\.json/);
    }
  }
});
