/**
 * git as the command line runs it: the settings that keep git from running
 * anything a clone configures, and the environment it runs in, so it never
 * asks on a terminal.
 *
 * `install` clones, `update` fetches and moves a clone forward, and a `wsl`
 * Place runs that same git inside its distribution. All three take these
 * from here, so a git command is guarded the same way wherever it runs
 * (ADR-0030).
 */

/** What one git command said, and how it ended. */
export type GitAnswer = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Run one git command in one Plugin's directory, and give back its answer. It
 * fails, with a sentence that says where git is missing, only when git cannot
 * be run at all; a command git runs and refuses is an answer.
 */
export type GitRunner = (argv: readonly string[]) => Promise<GitAnswer>;

/**
 * The settings that keep git from running a program a repository names: no
 * hook, no file-system monitor, and no `ext::` transport, which runs a
 * command as a remote. Given on the command line, they beat the clone's own
 * configuration. A clone's shipped files cannot configure git at all, so this
 * is defence in depth (ADR-0030).
 */
export const RUNS_NOTHING: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.ext.allow=never',
];

/** The variables that would point git at another repository than the Plugin's own. */
const ELSEWHERE = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

/**
 * What git and ssh are told so that neither asks on the terminal: no prompt,
 * and ssh in batch mode, unless the operator chose an ssh command of their own.
 */
function noQuestions(env: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: env['GIT_SSH_COMMAND'] ?? 'ssh -o BatchMode=yes',
  };
}

/** This environment, with git and ssh told not to ask on the terminal. */
export function askingNothing(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...noQuestions(env) };
}

/**
 * The environment `update` runs git in on this machine: it asks nothing,
 * reads its words in the C locale, so they can be read here, and is pointed
 * at no repository but the Plugin's own.
 */
export function gitEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ran: NodeJS.ProcessEnv = { ...askingNothing(env), LC_ALL: 'C' };
  for (const name of ELSEWHERE) delete ran[name];
  return ran;
}

/**
 * The same environment, as the words of an `env` command that runs git
 * somewhere this process's variables do not reach, such as a WSL
 * distribution. It starts with `env` and ends with `git`.
 */
export function gitEnvironmentWords(env: NodeJS.ProcessEnv): readonly string[] {
  const set = { ...noQuestions(env), LC_ALL: 'C' };
  return [
    'env',
    ...ELSEWHERE.flatMap((name) => ['-u', name]),
    ...Object.entries(set).map(([name, value]) => `${name}=${value}`),
    'git',
  ];
}
