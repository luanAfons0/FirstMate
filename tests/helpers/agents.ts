/**
 * A machine with a fake Agent, for the tests of the Mate.
 *
 * No test reaches a real Agent, an account or the network. `claude` is a small
 * program first on `PATH` that writes down how it was started and what it read
 * on standard input, then writes the JSON lines the real `claude -p
 * --output-format stream-json --verbose` writes, as a script of the test's own
 * tells it to. The shapes are copied from a real run of Claude Code on
 * 2026-10-12, so the Mate reads here what it reads on the operator's machine.
 *
 * The fake is a Node program, started by a shell script and, on Windows, by a
 * `claude.cmd` beside it, which is how an npm install of Claude Code is found
 * there (ADR-0019).
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

/** One step of what the fake Agent does once it has read its question. */
type Step =
  /** Write one text block of its answer, as an `assistant` line. */
  | { readonly say: string }
  /** Wait until this file is there, so a test can see what came before it. */
  | { readonly waitFor: string }
  /** Write the `result` line of an answer that is done. */
  | { readonly result: 'success' }
  /** Write this on standard error, and end with this code, with no `result` line. */
  | { readonly die: number; readonly stderr: string };

/** How the fake Agent was started, once. */
type Call = {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly cwd: string;
};

/** A fake Agent: how a test runs with it, and what it was asked. */
export type FakeAgent = {
  /** The environment that puts the fake first, and alone, on PATH. */
  readonly env: Readonly<Record<string, string>>;
  /** The home directory the operator has, where the Agent is started. */
  readonly home: string;
  /** Say what the fake does on its next start, and every start after it. */
  script(steps: readonly Step[]): Promise<void>;
  /** Every start the fake took, in order. */
  calls(): Promise<readonly Call[]>;
};

/** The fake `claude` itself. It reads its script and its log from beside itself. */
const FAKE_CLAUDE = `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8');
appendFileSync(join(here, 'calls.jsonl'), JSON.stringify({ argv, stdin, cwd: process.cwd() }) + '\\n');

const named = (flag) => {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : argv[at + 1];
};
const session = named('--session-id') ?? named('--resume') ?? 'no-session';
const write = (line) => process.stdout.write(JSON.stringify(line) + '\\n');
const steps = JSON.parse(readFileSync(join(here, 'script.json'), 'utf8'));

write({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: session, tools: [], model: 'claude-fake-1' });
let last = '';
for (const step of steps) {
  if ('say' in step) {
    last = step.say;
    write({ type: 'assistant', message: { model: 'claude-fake-1', type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '' }] }, parent_tool_use_id: null, session_id: session });
    write({ type: 'assistant', message: { model: 'claude-fake-1', type: 'message', role: 'assistant', content: [{ type: 'text', text: step.say }], stop_reason: null }, parent_tool_use_id: null, session_id: session });
  } else if ('waitFor' in step) {
    while (!existsSync(step.waitFor)) await new Promise((done) => setTimeout(done, 20));
  } else if ('result' in step) {
    write({ type: 'result', subtype: 'success', is_error: false, result: last, session_id: session, stop_reason: 'end_turn' });
  } else if ('die' in step) {
    process.stderr.write(step.stderr + '\\n');
    process.exit(step.die);
  }
}
`;

/**
 * A fake `claude`, alone on PATH with nothing else, so that a command finds no
 * real Agent the test did not ask for. Until a test says otherwise, it answers
 * "Ahoy." and is done.
 */
export async function fakeClaude(t: TestContext): Promise<FakeAgent> {
  const scratch = await makeHome(t);
  const bin = join(scratch, 'bin');
  const home = join(scratch, 'operator');
  await mkdir(bin);
  await mkdir(home);
  const program = join(bin, 'fake-claude.mjs');
  await writeFile(program, FAKE_CLAUDE);
  await writeFile(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${program}' "$@"\n`);
  await chmod(join(bin, 'claude'), 0o755);
  await writeFile(join(bin, 'claude.cmd'), `@"${process.execPath}" "${program}" %*\r\n`);
  const script = (steps: readonly Step[]): Promise<void> =>
    writeFile(join(bin, 'script.json'), JSON.stringify(steps));
  await script([{ say: 'Ahoy.' }, { result: 'success' }]);
  return {
    env: {
      PATH: [bin, ...windowsEssentials()].join(delimiter),
      HOME: home,
      USERPROFILE: home,
    },
    home,
    script,
    calls: async () => {
      const text = await readFile(join(bin, 'calls.jsonl'), 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Call);
    },
  };
}

/**
 * The directory cmd.exe is in, on Windows, which a `.cmd` file needs to start
 * at all. Anywhere else, nothing.
 */
function windowsEssentials(): readonly string[] {
  if (process.platform !== 'win32') return [];
  return [join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')];
}
