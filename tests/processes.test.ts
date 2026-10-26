/**
 * `/processes.json`: the Usage of FirstMate and of every Plugin, read when the
 * App or a terminal asks and kept nowhere (ADR-0032). A Plugin Page may never
 * read it, so a request that carries an Origin or a Sec-Fetch-Site is refused.
 */
import assert from 'node:assert/strict';
import { cp, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  bootHost,
  bootHostIn,
  DEFAULT_PLACE,
  firstmate,
  fixture,
  makeHome,
  type Booted,
} from './helpers/host.ts';
import { fakeWsl, type Wsl } from './helpers/wsl.ts';
import { pathWith } from './helpers/path.ts';

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

const run = promisify(execFile);

/** Why the figures of a local Plugin are read on Linux and Windows alone. */
const NO_READER =
  !['linux', 'win32'].includes(process.platform) &&
  'the Host reads the Usage of a local Plugin on Linux and Windows alone';

/** Why a test of PowerShell, which reads Usage on Windows, runs there alone. */
const NOT_WINDOWS =
  process.platform !== 'win32' && 'the Host reads Usage through PowerShell on Windows alone';

/**
 * Why the Usage of a `wsl` Place is read here on Linux alone: the fake
 * distribution is this machine, and its `/proc` is the one it prints.
 */
const NO_FAKE_PROC =
  process.platform !== 'linux' &&
  "the fake wsl.exe prints this machine's /proc, and Linux alone has one";

/**
 * A home that holds these Plugins. One with a distribution is put inside the
 * fake one, under the user's home, and added in a `wsl` Place of that
 * distribution, named after it in lower case; one with none stays here.
 */
async function wslHome(
  t: test.TestContext,
  wsl: Wsl,
  plugins: readonly { name: string; directory: string; distribution?: string }[],
): Promise<string> {
  const home = await makeHome(t);
  const places = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.distribution === undefined) {
      const added = await firstmate(home, ['add', plugin.name, fixture(plugin.directory)]);
      assert.equal(added.code, 0, added.stderr);
      continue;
    }
    const place = plugin.distribution.toLowerCase();
    if (!places.has(place)) {
      places.add(place);
      const added = await firstmate(
        home,
        ['place', 'add', place, 'wsl', plugin.distribution, wsl.root],
        wsl.env,
      );
      assert.equal(added.code, 0, added.stderr);
    }
    const inside = `${wsl.home}/plugins/${plugin.name}`;
    await mkdir(join(wsl.root, inside), { recursive: true });
    await cp(fixture(plugin.directory), join(wsl.root, inside), { recursive: true });
    const added = await firstmate(home, ['add', plugin.name, inside, '--place', place]);
    assert.equal(added.code, 0, added.stderr);
  }
  return home;
}

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

test(
  'a Plugin started from mcp.cmd counts the program under cmd.exe',
  { skip: NOT_WINDOWS },
  async (t) => {
    const host = await bootHost(t, [{ name: 'spawner', directory: 'spawner' }]);

    const spawner = rowOf(await processesOf(host), 'spawner');

    assertMeasured(spawner);
    // cmd.exe, the Node it runs mcp with, and the child that Node starts.
    assert.ok((spawner.processes ?? 0) >= 3, `the tree under cmd.exe: ${spawner.processes}`);
  },
);

test(
  'with no PowerShell to run, each row says it was not measured, and why',
  { skip: NOT_WINDOWS },
  async (t) => {
    const host = await bootHost(
      t,
      // spawner's mcp.cmd names its Node by FIRSTMATE_NODE, and needs no PATH.
      [
        { name: 'spawner', directory: 'spawner' },
        { name: 'quitter', directory: 'quitter' },
      ],
      { PATH: await pathWith(t, []) },
    );

    const processes = await processesOf(host);

    for (const row of [processes.firstmate, rowOf(processes, 'spawner')]) {
      assert.match(row.unmeasured ?? '', /^PowerShell .+\.$/, `${row.name} says why`);
      assert.equal(row.processes, null);
      assert.equal(row.cpuPercent, null);
      assert.equal(row.memoryBytes, null);
    }
    assert.equal(rowOf(processes, 'spawner').state, 'running');
    assert.equal(rowOf(processes, 'quitter').why, 'exit 3.', 'a Stopped row still says why');
  },
);

test(
  'a run of refreshes asks one PowerShell, which ends after the asks stop',
  { skip: NOT_WINDOWS },
  async (t) => {
    const host = await bootHost(t, [{ name: 'spawner', directory: 'spawner' }]);

    const first = await processesOf(host);
    assertMeasured(rowOf(first, 'spawner'));
    const hostPid = first.firstmate.pid ?? 0;
    const [shell, ...more] = await powerShellsUnder(hostPid);
    assert.ok(shell !== undefined, 'a PowerShell stays open after a reading');
    assert.deepEqual(more, [], 'one PowerShell, not one per reading');
    for (let refresh = 0; refresh < 3; refresh += 1) {
      assertMeasured(rowOf(await processesOf(host), 'spawner'));
      assert.deepEqual(await powerShellsUnder(hostPid), [shell], 'the same PowerShell answers');
    }

    await untilTrue(async () => (await powerShellsUnder(hostPid)).length === 0, 20_000);
    assertMeasured(rowOf(await processesOf(host), 'spawner'));
  },
);

test(
  'a PowerShell that dies is started again at the next reading',
  { skip: NOT_WINDOWS },
  async (t) => {
    const host = await bootHost(t, [{ name: 'spawner', directory: 'spawner' }]);
    const hostPid = (await processesOf(host)).firstmate.pid ?? 0;
    const [shell] = await powerShellsUnder(hostPid);
    assert.ok(shell !== undefined, 'a PowerShell stays open after a reading');

    process.kill(shell);
    await untilTrue(async () => !isAlive(shell), 10_000);

    const after = await processesOf(host);
    assertMeasured(after.firstmate);
    assertMeasured(rowOf(after, 'spawner'));
    const [again] = await powerShellsUnder(hostPid);
    assert.ok(again !== undefined && again !== shell, 'a new PowerShell answers');
  },
);

test('the PowerShell does not outlive a Host that ends', { skip: NOT_WINDOWS }, async (t) => {
  // No Plugin, so the Host ends alone: Windows ends one process at a time.
  const host = await bootHost(t, []);
  const hostPid = (await processesOf(host)).firstmate.pid ?? 0;
  const [shell] = await powerShellsUnder(hostPid);
  assert.ok(shell !== undefined, 'a PowerShell stays open after a reading');

  process.kill(hostPid);

  await untilTrue(async () => !isAlive(shell), 10_000);
});

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

test(
  'a Plugin in a wsl Place is measured inside its distribution, with the PID it has there',
  { skip: NO_FAKE_PROC },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const home = await wslHome(t, wsl, [
      { name: 'spawner', directory: 'spawner', distribution: 'Debian' },
    ]);
    const host = await bootHostIn(t, home, wsl.env);

    const processes = await processesOf(host);

    const spawner = rowOf(processes, 'spawner');
    assert.equal(spawner.state, 'running');
    assert.equal(spawner.place, 'debian');
    assertMeasured(spawner);
    assert.ok((spawner.processes ?? 0) >= 2, `the child is counted: ${spawner.processes}`);
    const server = (await wsl.ran()).find((one) => one.command.startsWith('env FIRSTMATE_PLUGIN='));
    assert.equal(spawner.pid, server?.pid, "the Plugin Server's PID inside, not wsl.exe's");
    assert.equal(processes.firstmate.place, DEFAULT_PLACE);
  },
);

test(
  'every row names its Place, and a distribution with no running Plugin is not asked',
  { skip: NO_FAKE_PROC },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian', 'Ubuntu']);
    const home = await wslHome(t, wsl, [
      { name: 'both', directory: 'both' },
      { name: 'spawner', directory: 'spawner', distribution: 'Debian' },
      { name: 'quitter', directory: 'quitter', distribution: 'Ubuntu' },
    ]);
    const host = await bootHostIn(t, home, wsl.env);
    const before = (await wsl.calls()).length;

    const processes = await processesOf(host);

    assert.equal(processes.firstmate.place, DEFAULT_PLACE);
    assert.deepEqual(
      processes.plugins.map((row) => [row.name, row.place, row.state]),
      [
        ['both', DEFAULT_PLACE, 'running'],
        ['spawner', 'debian', 'running'],
        ['quitter', 'ubuntu', 'stopped'],
      ],
    );
    assertMeasured(rowOf(processes, 'both'));
    assertMeasured(rowOf(processes, 'spawner'));
    const asked = (await wsl.calls()).slice(before);
    assert.ok(
      asked.some((call) => call.startsWith('wsl.exe -d Debian ')),
      'the distribution that holds a running Plugin is asked',
    );
    assert.deepEqual(
      asked.filter((call) => call.includes('-d Ubuntu')),
      [],
      'a distribution whose only Plugin is Stopped is never asked',
    );
  },
);

/** A Running Plugin's row that was not measured: no figures, and a sentence. */
function assertUnmeasured(row: Row, why: RegExp): void {
  assert.equal(row.state, 'running');
  assert.match(row.unmeasured ?? '', why);
  assert.deepEqual(
    [row.pid, row.processes, row.cpuPercent, row.memoryBytes],
    [null, null, null, null],
  );
  assert.ok(!Number.isNaN(Date.parse(row.startedAt ?? '')), 'the run still has its start time');
}

for (const [how, why] of [
  [
    'fails',
    /^the distribution Debian did not answer: The distribution Debian stopped answering\.$/,
  ],
  ['hangs', /^the distribution Debian did not answer within \d+ s\.$/],
] as const) {
  test(
    `a distribution that ${how} leaves its own rows unmeasured, and the others measured`,
    { skip: NO_FAKE_PROC },
    async (t) => {
      const wsl = await fakeWsl(t, ['Debian', 'Ubuntu']);
      const home = await wslHome(t, wsl, [
        { name: 'both', directory: 'both' },
        { name: 'spawner', directory: 'spawner', distribution: 'Debian' },
        { name: 'echoer', directory: 'both', distribution: 'Ubuntu' },
      ]);
      const host = await bootHostIn(t, home, wsl.env);
      await wsl.silence('Debian', how);

      const processes = await processesOf(host);

      assertUnmeasured(rowOf(processes, 'spawner'), why);
      assertMeasured(rowOf(processes, 'echoer'));
      assertMeasured(rowOf(processes, 'both'));
      assertMeasured(processes.firstmate);
    },
  );
}

/** The PIDs of the PowerShells whose parent is this process, as Windows lists them now. */
async function powerShellsUnder(parent: number): Promise<number[]> {
  const { stdout } = await run('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parent} AND Name='powershell.exe'").ProcessId`,
  ]);
  return stdout
    .split(/\r?\n/)
    .filter((line) => /^\d+$/.test(line.trim()))
    .map(Number);
}

/** Whether a process of this PID runs now. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait until the check holds, and fail if it never does in time. */
async function untilTrue(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`it did not happen in ${timeoutMs / 1000} s`);
    await new Promise((done) => setTimeout(done, 200));
  }
}
