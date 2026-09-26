/**
 * `firstmate service on|off`: the Host as a systemd user service.
 *
 * No test here reaches the real systemd. `systemctl` and `loginctl` are small
 * scripts first on `PATH` that write down what they were asked and answer as
 * the test says, and the unit lands in a temporary `XDG_CONFIG_HOME`. What a
 * test checks is what a person can check: the unit file, the commands run, and
 * what the command said.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { firstmate, makeHome, type CommandResult } from './helpers/host.ts';

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_SYSTEMD =
  'No systemd here, so the Host does not run as a service. Start it with `firstmate start`.';

/** How one fake answers a call whose arguments start with `when`. */
type Answer = { readonly when: string; readonly code: number; readonly says?: string };

type Machine = {
  readonly home: string;
  readonly config: string;
  readonly unit: string;
  readonly env: NodeJS.ProcessEnv;
  /** Every call the fakes took, one line each, in order. */
  calls(): Promise<readonly string[]>;
};

/**
 * A machine with a fake `systemctl` and `loginctl` and nothing else on `PATH`.
 * Every call succeeds unless an answer says otherwise.
 */
async function machine(
  t: TestContext,
  answers: { readonly systemctl?: readonly Answer[]; readonly loginctl?: readonly Answer[] } = {},
): Promise<Machine> {
  const home = await makeHome(t);
  const bin = join(home, 'bin');
  const config = join(home, 'config');
  const log = join(home, 'calls.log');
  await mkdir(bin);
  for (const tool of ['systemctl', 'loginctl'] as const) {
    await fake(join(bin, tool), tool, log, answers[tool] ?? []);
  }
  return {
    home,
    config,
    unit: join(config, 'systemd', 'user', 'firstmate.service'),
    env: { PATH: bin, XDG_CONFIG_HOME: config, USER: 'mate', WSL_DISTRO_NAME: '' },
    calls: async () => {
      const text = await readFile(log, 'utf8').catch(() => '');
      return text.split('\n').filter((line) => line !== '');
    },
  };
}

async function fake(path: string, tool: string, log: string, answers: readonly Answer[]) {
  const cases = answers
    .map((answer) => `  '${answer.when}'*) echo '${answer.says ?? ''}' >&2; exit ${answer.code};;`)
    .join('\n');
  await writeFile(
    path,
    `#!/bin/sh\necho "${tool} $*" >> '${log}'\ncase "$*" in\n${cases}\nesac\nexit 0\n`,
  );
  await chmod(path, 0o755);
}

function service(m: Machine, what: string, env: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return firstmate(m.home, ['service', what], { ...m.env, ...env });
}

test('service on writes the unit, enables the service and turns lingering on', async (t) => {
  const m = await machine(t);

  const on = await service(m, 'on');

  assert.equal(on.code, 0, on.stderr);
  assert.equal(on.stderr, '');
  assert.match(on.stdout, new RegExp(`installed ${m.unit}`));
  assert.deepEqual((await m.calls()).slice(1), [
    'systemctl --user daemon-reload',
    'systemctl --user enable --now firstmate.service',
    'loginctl enable-linger mate',
  ]);

  const unit = await readFile(m.unit, 'utf8');
  // The Node that ran the command, by its absolute path, because the service's
  // PATH has no nvm; and the Host entry point beside the running command line.
  assert.match(
    unit,
    new RegExp(`^ExecStart="${process.execPath}" "${REPOSITORY}/src/main.ts"$`, 'm'),
  );
  assert.match(unit, new RegExp(`^WorkingDirectory=${REPOSITORY}$`, 'm'));
  for (const line of [
    'Restart=on-failure',
    'StartLimitIntervalSec=60',
    'StartLimitBurst=3',
    'StandardOutput=journal',
    'KillSignal=SIGTERM',
    'TimeoutStopSec=15',
    'WantedBy=default.target',
  ]) {
    assert.match(unit, new RegExp(`^${line}$`, 'm'), line);
  }
});

test('service on asks first whether a user manager answers', async (t) => {
  const m = await machine(t);

  await service(m, 'on');

  assert.equal((await m.calls())[0], 'systemctl --user show-environment');
});

test('service on a second time succeeds and writes the unit again', async (t) => {
  const m = await machine(t);
  assert.equal((await service(m, 'on')).code, 0);
  await writeFile(m.unit, 'stale\n');

  const again = await service(m, 'on');

  assert.equal(again.code, 0, again.stderr);
  assert.match(await readFile(m.unit, 'utf8'), /^ExecStart=/m);
});

test('the unit lands under ~/.config when XDG_CONFIG_HOME is not set', async (t) => {
  const m = await machine(t);

  const on = await service(m, 'on', { XDG_CONFIG_HOME: '', HOME: m.home });

  assert.equal(on.code, 0, on.stderr);
  await readFile(join(m.home, '.config', 'systemd', 'user', 'firstmate.service'), 'utf8');
});

test('a lingering refusal is a warning that gives the sudo command', async (t) => {
  const m = await machine(t, {
    loginctl: [{ when: 'enable-linger', code: 1, says: 'Access denied' }],
  });

  const on = await service(m, 'on');

  assert.equal(on.code, 0, on.stderr);
  assert.match(on.stderr, /could not enable lingering\. Run: sudo loginctl enable-linger mate/);
  await readFile(m.unit, 'utf8');
});

test('any other failure names the command and what it said', async (t) => {
  const m = await machine(t, {
    systemctl: [{ when: '--user enable', code: 1, says: 'Unit is masked.' }],
  });

  const on = await service(m, 'on');

  assert.equal(on.code, 1);
  assert.match(on.stderr, /systemctl --user enable --now firstmate\.service/);
  assert.match(on.stderr, /Unit is masked\./);
  assert.ok(!(await m.calls()).some((call) => call.startsWith('loginctl')), 'it stopped there');
});

test('service off stops the service, removes the unit and leaves lingering on', async (t) => {
  const m = await machine(t);
  assert.equal((await service(m, 'on')).code, 0);
  const before = (await m.calls()).length;

  const off = await service(m, 'off');

  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, new RegExp(`removed ${m.unit}`));
  assert.deepEqual((await m.calls()).slice(before + 1), [
    'systemctl --user disable --now firstmate.service',
    'systemctl --user daemon-reload',
  ]);
  assert.deepEqual(await readdir(dirname(m.unit)), [], 'exactly the unit is gone');
});

test('service off with no service says so and succeeds', async (t) => {
  const m = await machine(t);

  const off = await service(m, 'off');

  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, /no service to remove/);
  assert.ok(!(await m.calls()).some((call) => call.includes('disable')), 'nothing to disable');
});

for (const what of ['on', 'off']) {
  test(`service ${what} with no systemctl on PATH says there is no systemd`, async (t) => {
    const m = await machine(t);
    const empty = join(m.home, 'empty');
    await mkdir(empty);

    const run = await service(m, what, { PATH: empty });

    assert.equal(run.code, 1);
    assert.equal(run.stderr, `firstmate: ${NO_SYSTEMD}\n`);
  });

  test(`service ${what} with no user manager says there is no systemd`, async (t) => {
    const m = await machine(t, {
      systemctl: [{ when: '--user show-environment', code: 1, says: 'Failed to connect to bus' }],
    });

    const run = await service(m, what);

    assert.equal(run.code, 1);
    assert.equal(run.stderr, `firstmate: ${NO_SYSTEMD}\n`);
    await assert.rejects(readFile(m.unit, 'utf8'), 'no unit is written');
  });
}

test('service takes on or off, and nothing else', async (t) => {
  const m = await machine(t);

  for (const argv of [['service'], ['service', 'up'], ['service', 'on', 'now']]) {
    const run = await firstmate(m.home, argv, m.env);
    assert.equal(run.code, 2, argv.join(' '));
    assert.match(run.stderr, /service takes on or off/);
  }
  assert.deepEqual(await m.calls(), []);
});

test('--help lists service', async (t) => {
  const home = await makeHome(t);

  const help = await firstmate(home, ['--help']);

  assert.match(help.stdout, /firstmate service on\|off/);
});

/**
 * A Node older than 24 that can still run this TypeScript, if this machine has
 * one: Node 22.18 and later strip types on their own. A machine without one
 * skips the test.
 */
async function olderNode(): Promise<string | undefined> {
  const versions = join(process.env['NVM_DIR'] ?? join(homedir(), '.nvm'), 'versions', 'node');
  const found = await readdir(versions).catch(() => [] as string[]);
  for (const version of found) {
    const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
    if (major < 24 && (major > 22 || (major === 22 && minor >= 18))) {
      return join(versions, version, 'bin', 'node');
    }
  }
  return undefined;
}

test('service on refuses a Node older than 24', async (t) => {
  const node = await olderNode();
  if (node === undefined) return t.skip('no Node older than 24 that strips types');
  const m = await machine(t);

  const run = await new Promise<CommandResult>((done, fail) => {
    const child = spawn(node, [join(REPOSITORY, 'src', 'cli.ts'), 'service', 'on'], {
      env: { ...process.env, FIRSTMATE_HOME: m.home, NODE_NO_WARNINGS: '1', ...m.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });

  assert.equal(run.code, 1);
  assert.match(run.stderr, /is Node v2\d\.\d+\.\d+\. The Host needs Node 24 or later\./);
  assert.deepEqual(await m.calls(), [], 'systemd is never asked');
});

/** The command that runs one of this program's own logon task scripts from Windows. */
function logonCommand(script: string): string {
  const path = join(REPOSITORY, 'windows', script).replaceAll('/', '\\');
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\\\wsl.localhost\\Debian${path}`;
}

test('inside WSL, service on prints the command that installs the logon task', async (t) => {
  const m = await machine(t);

  const on = await service(m, 'on', { WSL_DISTRO_NAME: 'Debian' });

  assert.equal(on.code, 0, on.stderr);
  assert.ok(on.stdout.includes(`\n${logonCommand('install-logon-task.ps1')}\n`), on.stdout);
  // The script it names is really there, beside the running program.
  await readFile(join(REPOSITORY, 'windows', 'install-logon-task.ps1'), 'utf8');
});

test('inside WSL, service off prints the command that removes the logon task', async (t) => {
  const m = await machine(t);
  assert.equal((await service(m, 'on')).code, 0);

  const off = await service(m, 'off', { WSL_DISTRO_NAME: 'Debian' });

  assert.equal(off.code, 0, off.stderr);
  assert.ok(off.stdout.includes(`\n${logonCommand('uninstall-logon-task.ps1')}\n`), off.stdout);
});

test('outside WSL, neither says anything about Windows', async (t) => {
  const m = await machine(t);

  const on = await service(m, 'on');
  const off = await service(m, 'off');

  for (const run of [on, off]) {
    assert.equal(run.code, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /Windows|powershell/);
  }
});
