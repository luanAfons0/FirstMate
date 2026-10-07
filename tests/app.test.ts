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
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { bootHost, packageApp, type Booted } from './helpers/host.ts';

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

/** One tool call, as a Plugin Page makes it: from its own page, same-origin. */
function ask(host: Booted, name: string, call: unknown): Promise<Response> {
  return host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${name}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(call),
  });
}

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
      ],
    });

    // The Plugin Server runs on FIRSTMATE_NODE, which is the App itself: an
    // answer proves the App runs as Node for a Plugin Server.
    const answer = await ask(host, 'server-only', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    });
    const said = (await answer.json()) as { result: { content: { text: string }[] } };
    assert.equal(answer.status, 200);
    assert.equal(said.result.content[0]?.text, 'pong from server-only');

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
