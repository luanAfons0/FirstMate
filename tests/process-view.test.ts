/**
 * The Process View is the App's own view, and the Host never serves it, so no
 * Plugin Page can read what it shows (ADR-0008, ADR-0032). The App's main
 * process reads `/processes.json` every 2 seconds while the view is shown, as
 * it reads `/plugins.json`: over loopback, with the token on the address and
 * no Origin. The window has no test (ADR-0020). What a browser and the main
 * process can see is pinned here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, DEFAULT_PLACE } from './helpers/host.ts';

/** Where a Process View might be looked for. */
const LOOKED_FOR = [
  '/processes',
  '/processes/',
  '/processes.html',
  '/process-view',
  '/usage',
  '/usage.json',
];

test('the Host serves no Process View', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  for (const path of LOOKED_FOR) {
    const answer = await host.fetch(path);
    assert.equal(answer.status, 404, path);
    assert.ok(!(await answer.text()).includes('cpuPercent'), `${path} shows no Usage`);
  }
});

test('the main process reads the rows the view draws, as it reads the Plugins', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'quitter', directory: 'quitter' },
    { name: 'page-only', directory: 'page-only' },
  ]);

  // As `askForProcesses` asks: Node's fetch, the token on the address, no
  // cookie and no Origin.
  const address = new URL('/processes.json', host.origin);
  address.searchParams.set('token', host.token);
  const answer = await fetch(address);

  assert.equal(answer.status, 200, await answer.clone().text());
  const said = (await answer.json()) as {
    firstmate: { name: string; place: string };
    plugins: { name: string; state: string; why?: string }[];
  };
  assert.equal(said.firstmate.name, 'FirstMate', 'FirstMate is the first row');
  assert.equal(said.firstmate.place, DEFAULT_PLACE);
  assert.deepEqual(
    said.plugins.map(({ name, state }) => [name, state]),
    [
      ['both', 'running'],
      ['quitter', 'stopped'],
      ['page-only', 'no-plugin-server'],
    ],
  );
  assert.equal(said.plugins[1]?.why, 'exit 3.', 'a Stopped row says why, for Restart to follow');
});
