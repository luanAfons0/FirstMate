/**
 * The App holds the Host.
 *
 * The App is the program a person installs on Windows and on Linux
 * (ADR-0026). This test packages it as a release does, starts the packaged
 * program with a home and a port of its own, and drives the Host inside it
 * through the same helper as every other test. The window has no test, as
 * ADR-0011 chose and ADR-0020 keeps: this proves only that the App holds a
 * working Host.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { bootHost, packageApp, type Booted } from './helpers/host.ts';
import { callTool } from './helpers/plugins.ts';

/** What packaging makes on one system, and how the packaged App is started there. */
type Packaged = {
  /** The packages a release ships, each matched by its whole file name. */
  readonly packages: readonly RegExp[];
  /** The directory of the unpacked program, under packaging's output. */
  readonly unpacked: string;
  /** The update feed electron-updater reads, under packaging's output. */
  readonly feed: string;
  /** Make the App ready to start from packaging's output, and say what starts it. */
  program(out: string): Promise<string>;
  /** Check what the packages carry beside the program, apart from starting it. */
  carries(out: string): Promise<void>;
};

/** Run one program to its end, and say what it wrote. */
const run = promisify(execFile);

/** The version packaging names every package after. */
const VERSION = (
  JSON.parse(await readFile('apps/desktop/package.json', 'utf8')) as { version: string }
).version;

const PACKAGED: Readonly<Partial<Record<NodeJS.Platform, Packaged>>> = {
  win32: {
    packages: [/^FirstMate-Setup-.+\.exe$/],
    unpacked: 'win-unpacked',
    feed: 'latest.yml',
    program: async (out) => join(out, 'win-unpacked', 'FirstMate.exe'),
    carries: async () => undefined,
  },
  linux: {
    packages: [/^FirstMate-.+\.AppImage$/, /^firstmate_.+\.deb$/],
    unpacked: 'linux-unpacked',
    feed: 'latest-linux.yml',
    program: (out) => unpackAppImage(out, `FirstMate-${VERSION}.AppImage`),
    carries: (out) => checkDeb(out, `firstmate_${VERSION}_amd64.deb`),
  },
};

/**
 * The deb names a maintainer a person can write to, and carries the AppArmor
 * profile its install script loads, so the Chromium sandbox runs on Ubuntu
 * 24.04, where AppArmor stops an unknown program from making a user namespace
 * (ADR-0026).
 */
async function checkDeb(out: string, name: string): Promise<void> {
  const deb = join(out, name);
  const { stdout: maintainer } = await run('dpkg-deb', ['--field', deb, 'Maintainer']);
  assert.match(
    maintainer.trim(),
    /^Luan Afonso <[^@\s]+@[^@\s]+>$/,
    'the deb names its maintainer',
  );

  const files = join(out, 'deb-files');
  const control = join(out, 'deb-control');
  await run('dpkg-deb', ['--extract', deb, files]);
  await run('dpkg-deb', ['--control', deb, control]);
  const profile = await readFile(
    join(files, 'opt', 'FirstMate', 'resources', 'apparmor-profile'),
    'utf8',
  );
  assert.match(
    profile,
    /^profile "firstmate-app" "\/opt\/FirstMate\/firstmate-app"/m,
    'it names the App',
  );
  assert.match(profile, /^\s*userns,$/m, 'it lets the App make a user namespace');
  const postinst = await readFile(join(control, 'postinst'), 'utf8');
  assert.ok(postinst.includes("'/etc/apparmor.d/firstmate-app'"), 'the install script loads it');
  assert.ok(
    postinst.includes("'/usr/bin/firstmate-app'") && !postinst.includes("'/usr/bin/firstmate'"),
    'the install script links firstmate-app on the path, and leaves firstmate to the command line',
  );
}

/**
 * Unpack the AppImage into packaging's output, and say where its AppRun is.
 *
 * The AppImage's runtime mounts its files and runs that AppRun, which runs the
 * App. A test machine may have no FUSE to mount with, and the runtime's other
 * way, unpack and run, keeps a process of its own that a signal never passes:
 * a test could not stop the App it started. Started by hand, AppRun is the App
 * itself, and it is the same AppRun the AppImage ships.
 */
async function unpackAppImage(out: string, name: string): Promise<string> {
  const unpacking = spawn(join(out, name), ['--appimage-extract'], { cwd: out, stdio: 'ignore' });
  const code = await new Promise<number | null>((done) => unpacking.once('exit', done));
  assert.equal(code, 0, 'the AppImage unpacks');
  return join(out, 'squashfs-root', 'AppRun');
}

/**
 * Every file the update feed names carries the SHA-512 and the size of that
 * file's bytes, and a block map beside a file was written from those bytes.
 * A release signs the Windows installer after it is built, which changes its
 * bytes, so packaging writes the feed last (ADR-0027). A feed that describes
 * other bytes is one electron-updater refuses.
 */
async function checkFeed(out: string, feed: string): Promise<void> {
  const text = await readFile(join(out, feed), 'utf8');
  const named = [...text.matchAll(/^(?: {2}- url|path): (.+)$/gm)].map((match) => match[1]);
  assert.ok(named.length > 0, `${feed} names a file`);
  for (const name of new Set(named)) {
    if (name === undefined) continue;
    const bytes = await readFile(join(out, name));
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    assert.ok(text.includes(`sha512: ${sha512}`), `${feed} carries the SHA-512 of ${name}`);
    const entry = new RegExp(
      `^ {2}- url: ${name.replaceAll('.', '\\.')}\\n {4}sha512: .+\\n {4}size: (\\d+)$`,
      'm',
    );
    assert.equal(
      text.match(entry)?.[1],
      String(bytes.length),
      `${feed} carries the size of ${name}`,
    );
    const map = join(out, `${name}.blockmap`);
    if (!existsSync(map)) continue;
    const blocks = JSON.parse(gunzipSync(await readFile(map)).toString('utf8')) as {
      files: { sizes: number[] }[];
    };
    const mapped = blocks.files[0]?.sizes.reduce((sum, size) => sum + size, 0);
    assert.equal(mapped, bytes.length, `the block map of ${name} covers its bytes`);
  }
}

/** FirstMate's row of `/processes.json`, as far as this test reads it. */
type OwnRow = {
  readonly pid: number | null;
  readonly processes: number | null;
  readonly unmeasured?: string;
};

/**
 * FirstMate's row counts the App: its main process, its GPU process and the
 * renderers of its own views, and no Plugin Server. No Plugin Page is open,
 * because the App opens the Index Page alone, so on Linux the row counts
 * every process Electron started for the App and nothing else. A system that
 * reads no Usage yet says so in the row, and has no figure to check.
 */
async function checkOwnRow(host: Booted): Promise<void> {
  const ask = async (): Promise<OwnRow> => {
    const answer = await host.fetch('/processes.json');
    assert.equal(answer.status, 200, await answer.clone().text());
    return ((await answer.json()) as { firstmate: OwnRow }).firstmate;
  };
  let row = await ask();
  if (process.platform !== 'linux') {
    if (row.unmeasured === undefined) {
      assert.ok((row.processes ?? 0) > 1, `the row counts the App: ${row.processes}`);
    }
    return;
  }
  assert.equal(row.unmeasured, undefined, row.unmeasured);
  assert.ok(row.pid !== null, 'the row names the main process');
  assert.ok(
    (row.processes ?? 0) > 1,
    `the row counts more than the main process: ${row.processes}`,
  );
  // Electron starts and ends a helper now and then, so the two counts are
  // compared again, a few times, before the test calls them different.
  let electron = await electronProcesses(row.pid);
  for (let tries = 0; row.processes !== electron.length && tries < 5; tries += 1) {
    await delay(500);
    row = await ask();
    electron = await electronProcesses(row.pid ?? 0);
  }
  assert.ok(
    electron.some((one) => one.type === 'gpu-process'),
    'the App has a GPU process to count',
  );
  assert.equal(
    row.processes,
    electron.length,
    `the row counts each of the App's own processes: ${JSON.stringify(electron)}`,
  );
}

/** The types of process Electron starts and does not name among the App's. */
const UNNAMED: ReadonlySet<string> = new Set(['zygote', 'broker']);

/**
 * The main process at this PID, and every process under it that Electron
 * started as one of its own, which names its type on its command line. A
 * Plugin Server is the App's executable run as Node, and names no type. A
 * zygote, the template each renderer starts from on Linux, and a broker, which
 * opens files for the sandboxed GPU process when it draws in software, are
 * left out: Electron does not name them among the App's processes, so the row
 * cannot.
 */
async function electronProcesses(
  main: number,
): Promise<readonly { readonly pid: number; readonly type: string }[]> {
  const parents = new Map<number, number>();
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const stat = await readFile(join('/proc', name, 'stat'), 'utf8').catch(() => '');
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    if (Number.isInteger(parent)) parents.set(Number(name), parent);
  }
  const under = (pid: number): boolean => {
    for (let at = parents.get(pid); at !== undefined && at > 0; at = parents.get(at)) {
      if (at === main) return true;
    }
    return false;
  };
  const found = [{ pid: main, type: 'browser' }];
  for (const pid of parents.keys()) {
    if (!under(pid)) continue;
    const line = await readFile(join('/proc', String(pid), 'cmdline'), 'utf8').catch(() => '');
    // Chromium writes its command line again as one line, words split by
    // spaces, so a word ends at either.
    const type = /(?:^|[\0 ])--type=([^\0 ]+)/.exec(line)?.[1];
    if (type !== undefined && !UNNAMED.has(type)) found.push({ pid, type });
  }
  return found;
}

const packaged = PACKAGED[process.platform];

/**
 * Why this machine cannot start the App, if it cannot. On Linux the App needs
 * a display for its window and its Tray, and CI gives it one with xvfb.
 */
function cannotStart(): string | false {
  if (packaged === undefined) return 'the App runs on Windows and Linux only (ADR-0026)';
  const displays = [process.env['DISPLAY'], process.env['WAYLAND_DISPLAY']];
  if (
    process.platform === 'linux' &&
    !displays.some((display) => display !== undefined && display !== '')
  ) {
    return 'this machine has no display to start the App on';
  }
  return false;
}

const skip = cannotStart();

test(
  'the packaged App holds a Host, and a second start holds no second one',
  { skip },
  async (t) => {
    if (packaged === undefined) return;
    const out = await packageApp(t);
    const made = await readdir(out);
    for (const name of packaged.packages) {
      assert.equal(made.filter((file) => name.test(file)).length, 1, `packaging makes ${name}`);
    }
    await packaged.carries(out);
    await checkFeed(out, packaged.feed);

    // The App learns where to look for an update from this file, which
    // packaging writes from the publish block of electron-builder.yml.
    const feed = await readFile(
      join(out, packaged.unpacked, 'resources', 'app-update.yml'),
      'utf8',
    );
    assert.match(feed, /^provider: github$/m);
    assert.match(feed, /^owner: luanAfons0$/m);
    assert.match(feed, /^repo: FirstMate$/m);

    const app = await packaged.program(out);
    const host = await bootHost(
      t,
      [
        { name: 'server-only', directory: 'app-node' },
        { name: 'page-only', directory: 'page-only' },
        { name: 'node-form', directory: 'node-form' },
      ],
      {},
      { app },
    );

    const index = await host.fetch('/');
    assert.equal(index.status, 200);
    assert.ok((await index.text()).includes('/p/page-only/'), 'the Index Page links the page');

    const listed = await host.fetch('/plugins.json');
    assert.deepEqual(await listed.json(), {
      plugins: [
        { name: 'server-only', hasPage: false, state: 'running' },
        { name: 'page-only', hasPage: true, state: 'no-plugin-server' },
        { name: 'node-form', hasPage: false, state: 'running' },
      ],
    });

    // The Plugin Server runs on FIRSTMATE_NODE, which is the App itself: an
    // answer proves the App runs as Node for a Plugin Server.
    assert.deepEqual(await callTool(host, 'server-only', 'ping'), {
      status: 200,
      text: 'pong from server-only',
    });

    // A Plugin with only mcp.ts is started by the App as Node, with the file
    // as its one argument, and the App's Node strips its types (ADR-0028).
    assert.deepEqual(await callTool(host, 'node-form', 'ping'), {
      status: 200,
      text: 'pong from mcp.ts',
    });

    await checkOwnRow(host);

    const runtime = await readFile(join(host.home, 'runtime.json'), 'utf8');
    const second = spawn(app, [], {
      env: { ...process.env, FIRSTMATE_HOME: host.home, FIRSTMATE_PORT: '0' },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((done) => second.once('exit', done));
    assert.equal(code, 0, 'a second start ends at once, and calmly');
    assert.equal(
      await readFile(join(host.home, 'runtime.json'), 'utf8'),
      runtime,
      'the first Host is still the one the runtime file names',
    );
    assert.equal((await host.fetch('/plugins.json')).status, 200, 'and it still answers');
  },
);
