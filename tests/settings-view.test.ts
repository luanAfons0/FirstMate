/**
 * The Settings View is the App's own view, and the Host never serves it, so no
 * Plugin Page can reach it (ADR-0008, ADR-0012). The App changes a setting in
 * its main process, through `core`; the window has no test (ADR-0020). What a
 * browser can see is pinned here: no address on the Host shows the settings
 * or changes one.
 */
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';

/** Where a Settings View, or a way to write a setting, might be looked for. */
const LOOKED_FOR = ['/settings', '/settings/', '/settings.html', '/settings.json', '/places'];

test('the Host serves no Settings View, and no address on it writes a setting', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  for (const path of LOOKED_FOR) {
    for (const method of ['GET', 'POST']) {
      const answer = await host.fetch(path, {
        method,
        ...(method === 'POST' ? { body: '{"shelf":"/elsewhere"}' } : {}),
      });
      assert.equal(answer.status, 404, `${method} ${path}`);
    }
  }

  await assert.rejects(access(join(host.home, 'settings.json')), 'nothing wrote a setting');
});
