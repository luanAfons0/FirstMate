/**
 * A machine with a fake WSL, for the tests of the `wsl` Place.
 *
 * No test reaches a real distribution. `wsl.exe` is a small script first on
 * `PATH` that writes down what it was asked and runs the command here, in a
 * folder of the test's own that stands for the distribution's `/`. The Place's
 * root points at that same folder, so the files the Host reads through the
 * root are the files the fake runs: the Place's own data is the seam.
 *
 * The fake is a shell script, so these tests run where a shell does. On
 * Windows the real `wsl.exe` is in System32 and a script cannot stand in for
 * it, so the tests skip there and say so.
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

/** Why the tests of the `wsl` Place do not run on Windows. */
export const NO_FAKE_WSL =
  process.platform === 'win32' && 'the fake wsl.exe is a shell script, and Windows runs none';

/** Whether this environment carries a fake WSL, so a `wsl` Place can run in it. */
export function holdsFakeWsl(env: NodeJS.ProcessEnv): boolean {
  const first = (env['PATH'] ?? '').split(delimiter)[0] ?? '';
  return first !== '' && existsSync(join(first, 'wsl.exe'));
}

/** A fake WSL: where it keeps its files, and how a test runs with it. */
export type Wsl = {
  /** The folder that stands for the distribution's `/`, and the Place's root. */
  readonly root: string;
  /** The distribution user's home directory, inside the distribution. */
  readonly home: string;
  /**
   * The environment that puts the fake first on PATH, where the command line
   * and the Host find it, so a `wsl` Place can be added off Windows.
   */
  readonly env: Readonly<Record<string, string>>;
  /** Every call the fake took, one line each, in order. */
  calls(): Promise<readonly string[]>;
};

/** What the fake distribution holds besides its files. */
type Holding = {
  /** Whether a 1.x Host runs there as a systemd user service. */
  readonly service?: boolean;
};

/**
 * A fake WSL that knows these distributions. A command for any other one is
 * refused, as the real `wsl.exe` refuses a distribution it does not have.
 * Inside it, `systemctl` is a fake too, which writes down what it was asked.
 */
export async function fakeWsl(
  t: TestContext,
  distributions: readonly string[],
  holding: Holding = {},
): Promise<Wsl> {
  const scratch = await makeHome(t);
  const bin = join(scratch, 'bin');
  const root = join(scratch, 'root');
  const log = join(scratch, 'wsl.log');
  const home = '/home/mate';
  await mkdir(bin);
  await mkdir(join(root, home), { recursive: true });
  const script = `#!/bin/sh
echo "wsl.exe $*" >> '${log}'
distribution=''
directory=''
while [ $# -gt 0 ]; do
  case "$1" in
    -d) distribution="$2"; shift 2 ;;
    --cd) directory="$2"; shift 2 ;;
    --exec|--) shift; break ;;
    *) break ;;
  esac
done
case ' ${distributions.join(' ')} ' in
  *" $distribution "*) ;;
  *) echo "There is no distribution with the supplied name." >&2; exit 1 ;;
esac
export HOME='${home}'
if [ -n "$directory" ]; then cd '${root}'"$directory" || exit 1; fi
exec "$@"
`;
  await writeFile(join(bin, 'wsl.exe'), script);
  await chmod(join(bin, 'wsl.exe'), 0o755);
  const running = holding.service === true ? 0 : 3;
  const systemctl = `#!/bin/sh
echo "systemctl $*" >> '${log}'
case "$*" in
  *is-enabled*|*is-active*) exit ${running} ;;
esac
exit 0
`;
  await writeFile(join(bin, 'systemctl'), systemctl);
  await chmod(join(bin, 'systemctl'), 0o755);
  return {
    root,
    home,
    env: { PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}` },
    calls: async () => {
      const text = await readFile(log, 'utf8').catch(() => '');
      return text.split('\n').filter((line) => line !== '');
    },
  };
}
