/**
 * A machine with a fake Windows and a fake GitHub Release, for the tests of
 * `firstmate desktop`.
 *
 * No test reaches the real Windows or the real Release. FIRSTMATE_RELEASES_URL
 * points the command line at a server of the test's own, `release.ts`, which
 * holds a fake installer and its checksum under the names a Release holds
 * them by. The
 * Windows programs the command line runs are fakes first on PATH, and nothing
 * else is on PATH, so a fake a test forgets finds no real program either. The
 * fakes play their parts in `windows-fake.ts`, and keep the registry in a
 * file of the machine's own.
 *
 * On Linux the machine is WSL, with `cmd.exe` and `wslpath` faked beside
 * `reg.exe`. On Windows the fakes are copies of Node, so the installer the
 * server holds is one too.
 *
 * The installer's name and the GUID of the App's registry keys are read from
 * `electron-builder.yml`, which the real installer is built from, so the
 * command line is held to what packaging writes.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';
import { type Release, serveRelease } from './release.ts';
import { FAKE, here, install, writeFake, type Machine } from './windows-fake.ts';

const REPOSITORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export type FakeWindows = {
  /** The environment the command line runs with on this machine. */
  readonly env: Readonly<Record<string, string>>;
  /** The command line's own version, which is the App's it installs. */
  readonly version: string;
  /** Windows' temp folder, as the test reaches it. */
  readonly temp: string;
  /** Every path the Release server was asked for, in order. */
  readonly asked: readonly string[];
  /** Install the App of this version, as its installer would. */
  install(version: string): void;
  /** Every call the fakes took, one line each, in order. */
  calls(): Promise<readonly string[]>;
  /** Wait for a call that matches. The App is opened on its own, after the command ends. */
  until(pattern: RegExp): Promise<void>;
};

/** A fake Windows, reached as this platform reaches it, and a fake Release. */
export async function fakeWindows(t: TestContext, release: Release = 'good'): Promise<FakeWindows> {
  const root = await makeHome(t);
  const bin = join(root, 'bin');
  await mkdir(bin);
  const builder = await readFile(
    join(REPOSITORY, 'apps', 'desktop', 'electron-builder.yml'),
    'utf8',
  );
  const guid = /^\s+guid:\s*(\S+)$/m.exec(builder)?.[1] ?? 'no guid in electron-builder.yml';
  const artifact = /^\s+artifactName:\s*(\S+)$/m.exec(builder)?.[1] ?? '';
  const manifest = await readFile(join(REPOSITORY, 'apps', 'cli', 'package.json'), 'utf8');
  const version = (JSON.parse(manifest) as { version: string }).version;

  const windows = process.platform === 'win32';
  const machine: Machine = {
    uninstallKey: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`,
    installKey: `HKCU\\Software\\${guid}`,
    temp: windows ? join(root, 'Temp') : 'C:\\Users\\mate\\AppData\\Local\\Temp',
    installTo: windows
      ? join(root, 'Programs', 'FirstMate')
      : 'C:\\Users\\mate\\AppData\\Local\\Programs\\FirstMate',
  };
  await writeFile(join(root, 'machine.json'), JSON.stringify(machine, null, 2));
  const temp = here(root, machine.temp);
  await mkdir(temp, { recursive: true });
  for (const tool of windows ? ['reg.exe'] : ['reg.exe', 'cmd.exe', 'wslpath']) {
    writeFake(join(bin, tool));
  }

  // The installer, under the name packaging gives it, is a fake of its own.
  const name = artifact.replace(/\$\{version\}/, version).replace(/\$\{ext\}/, 'exe');
  const made = join(root, 'made');
  await mkdir(made);
  writeFake(join(made, name));
  const served = await serveRelease(t, release, version, name, await readFile(join(made, name)));

  const calls = async (): Promise<readonly string[]> => {
    const text = await readFile(join(root, 'calls.log'), 'utf8').catch(() => '');
    return text.split('\n').filter((line) => line !== '');
  };

  return {
    env: {
      FIRSTMATE_RELEASES_URL: served.url,
      FAKE_WINDOWS: root,
      PATH: bin,
      ...(windows
        ? {
            TEMP: machine.temp,
            TMP: machine.temp,
            NODE_OPTIONS: `--import=${pathToFileURL(FAKE).href}`,
          }
        : { WSL_DISTRO_NAME: 'Debian' }),
    },
    version,
    temp,
    asked: served.asked,
    install: (installed) => install(root, machine, installed),
    calls,
    until: async (pattern) => {
      const deadline = Date.now() + 10_000;
      while (!(await calls()).some((line) => pattern.test(line))) {
        if (Date.now() > deadline) {
          throw new Error(
            `no fake was called as ${String(pattern)}:\n${(await calls()).join('\n')}`,
          );
        }
        await new Promise((done) => setTimeout(done, 20));
      }
    },
  };
}
