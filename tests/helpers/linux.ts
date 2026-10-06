/**
 * A Linux desktop with a home of its own and a fake GitHub Release, for the
 * tests of `firstmate desktop` outside WSL.
 *
 * No test reaches the real Release or the real `~/Applications`. HOME is a
 * folder of the test's own, so the AppImage lands in it, and
 * FIRSTMATE_RELEASES_URL points at `release.ts`, which holds a fake AppImage
 * and its checksum under the names packaging gives them. The fake AppImage is
 * a shell script: started, it writes one line to `calls.log`, with the
 * version it was made for, and ends. That line is all a test sees of the App.
 * Asked to extract its desktop entry, as a real AppImage's runtime is, it
 * writes one that names that version, and logs nothing: that is no start.
 *
 * The AppImage's name is read from `electron-builder.yml`, which the real one
 * is built from, so the command line is held to what packaging writes.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';
import { type Release, serveRelease } from './release.ts';

const REPOSITORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** A Linux desktop of a test's own, and what the command line did on it. */
export type FakeLinux = {
  /** The environment the command line runs with on this desktop. */
  readonly env: Readonly<Record<string, string>>;
  /** The command line's own version, which is the App's it installs. */
  readonly version: string;
  /** Where the App is installed: `~/Applications/FirstMate.AppImage`. */
  readonly program: string;
  /** Every path the Release server was asked for, in order. */
  readonly asked: readonly string[];
  /** Install the AppImage of this version, as `firstmate desktop` or an update would. */
  install(version: string): Promise<void>;
  /** Put a program at the AppImage's place that says no version, as one put there by hand. */
  placeByHand(): Promise<void>;
  /** Every start of an AppImage, one line each: its version, then its words. */
  calls(): Promise<readonly string[]>;
  /** Wait for a start that matches. The App is opened on its own, after the command ends. */
  until(pattern: RegExp): Promise<void>;
};

/** A Linux desktop outside WSL, with its own home, and a fake Release. */
export async function fakeLinux(t: TestContext, release: Release = 'good'): Promise<FakeLinux> {
  const root = await makeHome(t);
  const user = join(root, 'a mate');
  await mkdir(user);
  const builder = await readFile(
    join(REPOSITORY, 'apps', 'desktop', 'electron-builder.yml'),
    'utf8',
  );
  const artifact = /^appImage:\n\s+artifactName:\s*(\S+)$/m.exec(builder)?.[1] ?? '';
  const manifest = await readFile(join(REPOSITORY, 'apps', 'cli', 'package.json'), 'utf8');
  const version = (JSON.parse(manifest) as { version: string }).version;

  const log = join(root, 'calls.log');
  const appImage = (made: string): Buffer =>
    Buffer.from(`#!/bin/sh
if [ "$1" = --appimage-extract ]; then
  mkdir -p squashfs-root
  printf '[Desktop Entry]\\nName=FirstMate\\nX-AppImage-Version=${made}\\n' > "squashfs-root/$2"
  exit 0
fi
echo "FirstMate.AppImage ${made} $*" >> '${log}'
`);
  const name = artifact.replace(/\$\{version\}/, version).replace(/\$\{ext\}/, 'AppImage');
  const served = await serveRelease(t, release, version, name, appImage(version));

  const program = join(user, 'Applications', 'FirstMate.AppImage');
  const calls = async (): Promise<readonly string[]> => {
    const text = await readFile(log, 'utf8').catch(() => '');
    return text.split('\n').filter((line) => line !== '');
  };

  return {
    env: { HOME: user, FIRSTMATE_RELEASES_URL: served.url, WSL_DISTRO_NAME: '' },
    version,
    program,
    asked: served.asked,
    install: async (installed) => {
      await mkdir(dirname(program), { recursive: true });
      await writeFile(program, appImage(installed));
      await chmod(program, 0o755);
    },
    placeByHand: async () => {
      await mkdir(dirname(program), { recursive: true });
      await writeFile(program, `#!/bin/sh\necho "by hand $*" >> '${log}'\n`);
      await chmod(program, 0o755);
    },
    calls,
    until: async (pattern) => {
      const deadline = Date.now() + 10_000;
      while (!(await calls()).some((line) => pattern.test(line))) {
        if (Date.now() > deadline) {
          throw new Error(
            `no AppImage started as ${String(pattern)}:\n${(await calls()).join('\n')}`,
          );
        }
        await new Promise((done) => setTimeout(done, 20));
      }
    },
  };
}
