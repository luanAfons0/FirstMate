/**
 * A machine with a fake systemd, for the tests of `service` and `setup`.
 *
 * No test reaches the real systemd. `systemctl` and `loginctl` are small
 * scripts first on `PATH` that write down what they were asked and answer as
 * the test says, and the unit lands in a temporary `XDG_CONFIG_HOME`. Nothing
 * else is on `PATH` unless a test names it, so a test that forgets a fake
 * finds no real one either.
 */
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { accessSync, constants } from 'node:fs';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

/** How one fake answers a call whose arguments start with `when`. */
type Answer = { readonly when: string; readonly code: number; readonly says?: string };

/** How each fake answers. Every call it has no answer for succeeds. */
export type Answers = {
  readonly systemctl?: readonly Answer[];
  readonly loginctl?: readonly Answer[];
};

export type Machine = {
  readonly home: string;
  readonly config: string;
  readonly unit: string;
  readonly env: NodeJS.ProcessEnv;
  /** Every call the fakes took, one line each, in order. */
  calls(): Promise<readonly string[]>;
};

/**
 * A machine with a fake `systemctl` and `loginctl` on `PATH`, and the real
 * tools named in `tools` beside them.
 */
export async function machine(
  t: TestContext,
  answers: Answers = {},
  tools: readonly string[] = [],
): Promise<Machine> {
  const home = await makeHome(t);
  const bin = await binWith(t, tools);
  const config = join(home, 'config');
  const log = join(home, 'calls.log');
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

/**
 * A directory for `PATH` that holds these real tools and nothing else: a
 * machine with no systemd, where the tools a test needs still work.
 */
export async function binWith(t: TestContext, tools: readonly string[]): Promise<string> {
  const bin = join(await makeHome(t), 'bin');
  await mkdir(bin);
  for (const tool of tools) {
    const found = (process.env['PATH'] ?? '')
      .split(delimiter)
      .map((directory) => join(directory, tool))
      .find(isExecutable);
    if (found !== undefined) await symlink(found, join(bin, tool));
  }
  return bin;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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
