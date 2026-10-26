/**
 * `/processes.json`: the Usage of FirstMate and of every Plugin, read when the
 * App or a terminal asks and kept nowhere (ADR-0032). A Plugin Page may never
 * read it, so a request that carries an Origin or a Sec-Fetch-Site is refused.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost, DEFAULT_PLACE, firstmate, type Booted } from './helpers/host.ts';

/** One row of `/processes.json`, as the App and a terminal read it. */
type Row = {
  name: string;
  state: string;
  place: string;
  pid: number | null;
  processes: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  startedAt: string | null;
  why?: string;
  unmeasured?: string;
};

type Processes = { firstmate: Row; plugins: Row[] };

/** Why the figures of a local Plugin are read on Linux alone, so far. */
const NO_READER =
  process.platform !== 'linux' && 'the Host reads the Usage of a local Plugin on Linux alone';

async function processesOf(host: Booted): Promise<Processes> {
  const answer = await host.fetch('/processes.json');
  assert.equal(answer.status, 200, await answer.clone().text());
  assert.match(answer.headers.get('content-type') ?? '', /^application\/json/);
  return (await answer.json()) as Processes;
}

function rowOf(processes: Processes, name: string): Row {
  const row = processes.plugins.find((plugin) => plugin.name === name);
  assert.ok(row !== undefined, `no row for ${name}`);
  return row;
}

/** A row the Host measured: every figure is there, on the first ask. */
function assertMeasured(row: Row): void {
  assert.equal(row.unmeasured, undefined, row.unmeasured);
  assert.ok(Number.isInteger(row.pid) && (row.pid ?? 0) > 0, `a PID: ${row.pid}`);
  assert.ok((row.processes ?? 0) >= 1, `a process: ${row.processes}`);
  assert.ok((row.memoryBytes ?? 0) > 0, `memory: ${row.memoryBytes}`);
  assert.equal(typeof row.cpuPercent, 'number', 'a CPU figure on the first ask');
  assert.ok((row.cpuPercent ?? -1) >= 0);
  assert.ok(!Number.isNaN(Date.parse(row.startedAt ?? '')), `a start time: ${row.startedAt}`);
}

test('FirstMate comes first, then every Plugin in the Plugin Order', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'page-only', directory: 'page-only' },
    { name: 'quitter', directory: 'quitter' },
  ]);
  await firstmate(host.home, ['order', 'quitter', '1']);

  const processes = await processesOf(host);

  assert.equal(processes.firstmate.name, 'FirstMate');
  assert.equal(processes.firstmate.state, 'running');
  assert.equal(processes.firstmate.place, DEFAULT_PLACE);
  assert.deepEqual(
    processes.plugins.map((row) => row.name),
    ['quitter', 'both', 'page-only'],
  );
  assert.deepEqual(
    processes.plugins.map((row) => row.place),
    [DEFAULT_PLACE, DEFAULT_PLACE, DEFAULT_PLACE],
  );
});

test(
  'a Running Plugin and FirstMate are measured on the first ask',
  { skip: NO_READER },
  async (t) => {
    const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

    const processes = await processesOf(host);

    assertMeasured(processes.firstmate);
    const both = rowOf(processes, 'both');
    assert.equal(both.state, 'running');
    assertMeasured(both);
    assert.equal(both.why, undefined);
  },
);

test(
  'a Plugin Server that starts a child counts both processes',
  { skip: NO_READER },
  async (t) => {
    const host = await bootHost(t, [{ name: 'spawner', directory: 'spawner' }]);

    const spawner = rowOf(await processesOf(host), 'spawner');

    assertMeasured(spawner);
    assert.ok((spawner.processes ?? 0) >= 2, `the child is counted: ${spawner.processes}`);
  },
);

test('a Stopped Plugin says why, and a Plugin with no Plugin Server says so', async (t) => {
  const host = await bootHost(t, [
    { name: 'quitter', directory: 'quitter' },
    { name: 'page-only', directory: 'page-only' },
  ]);

  const processes = await processesOf(host);

  assert.deepEqual(rowOf(processes, 'quitter'), {
    name: 'quitter',
    state: 'stopped',
    place: DEFAULT_PLACE,
    pid: null,
    processes: null,
    cpuPercent: null,
    memoryBytes: null,
    startedAt: null,
    why: 'exit 3.',
  });
  assert.deepEqual(rowOf(processes, 'page-only'), {
    name: 'page-only',
    state: 'no-plugin-server',
    place: DEFAULT_PLACE,
    pid: null,
    processes: null,
    cpuPercent: null,
    memoryBytes: null,
    startedAt: null,
  });
});

test('a restart is a new run: a new PID and a later start time', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);
  const before = rowOf(await processesOf(host), 'both');

  const restarted = await firstmate(host.home, ['restart', 'both']);

  assert.equal(restarted.code, 0, restarted.stderr);
  const after = rowOf(await processesOf(host), 'both');
  assert.equal(after.state, 'running');
  assert.notEqual(after.pid, before.pid, 'a new process');
  assert.ok(after.pid !== null && after.pid > 0);
  assert.ok(Date.parse(after.startedAt ?? '') > Date.parse(before.startedAt ?? ''));
});

test('a Stopped Plugin restarted and Stopped again still says why', async (t) => {
  const host = await bootHost(t, [{ name: 'quitter', directory: 'quitter' }]);

  await firstmate(host.home, ['restart', 'quitter']);

  const quitter = rowOf(await processesOf(host), 'quitter');
  assert.equal(quitter.state, 'stopped');
  assert.equal(quitter.why, 'exit 3.');
  assert.equal(quitter.startedAt, null, 'no figures, and no uptime');
});

test('an empty Registry still gives FirstMate its row', async (t) => {
  const host = await bootHost(t, []);

  const processes = await processesOf(host);

  assert.equal(processes.firstmate.name, 'FirstMate');
  assert.deepEqual(processes.plugins, []);
});

test('only the App and a terminal may read Usage, never a page', async (t) => {
  const host = await bootHost(t, [{ name: 'both', directory: 'both' }]);

  const stranger = await host.raw({ path: '/processes.json', anonymous: true });
  assert.equal(stranger.status, 403, 'no token');

  const written = await host.raw({ method: 'POST', path: '/processes.json' });
  assert.equal(written.status, 405, 'nothing is written here');
  assert.equal(written.headers['allow'], 'GET, HEAD');

  const page = await host.raw({
    path: '/processes.json',
    headers: { origin: host.origin, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(page.status, 403, 'a Plugin Page shares the origin, and is refused');

  const origin = await host.raw({ path: '/processes.json', headers: { origin: host.origin } });
  assert.equal(origin.status, 403, 'an Origin alone is refused');

  const fetched = await host.raw({
    path: '/processes.json',
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(fetched.status, 403, 'a Sec-Fetch-Site alone is refused');

  const typed = await host.raw({
    path: '/processes.json',
    headers: {
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
  });
  assert.equal(typed.status, 403, 'an address typed into a browser is refused too');

  const terminal = await host.raw({ path: `/processes.json?token=${host.token}`, anonymous: true });
  assert.equal(terminal.status, 200, 'a terminal with the token is answered');

  const head = await host.raw({ method: 'HEAD', path: '/processes.json' });
  assert.equal(head.status, 200);
});
