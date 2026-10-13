/**
 * A machine with a fake Agent, for the tests of the Mate.
 *
 * No test reaches a real Agent, an account or the network. `claude` and
 * `codex` are each a small program first on `PATH` that writes down how it was
 * started and what it read on standard input, then writes the JSON lines the
 * real one writes, as a script of the test's own tells it to. The shapes are
 * copied from real runs on 2026-10-12: `claude -p --output-format stream-json
 * --verbose` of Claude Code, and `codex exec --json` of codex-cli 0.147.0. So
 * the Mate reads here what it reads on the operator's machine. What each says
 * with no login was copied on 2026-10-13, from runs with a home of their own.
 *
 * Like the real ones, each fake remembers each session it started, and refuses
 * to resume one it does not know, in the words and with the code the real one
 * uses.
 *
 * A fake is a Node program, started by a shell script and, on Windows, by a
 * `.cmd` beside it, which is how an npm install of either Agent is found there
 * (ADR-0019).
 */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

/** One step of what the fake Agent does once it has read its question. */
type Step =
  /** Write one text block of its answer, as an `assistant` line. */
  | { readonly say: string }
  /** Wait until this file is there, so a test can see what came before it. */
  | { readonly waitFor: string }
  /** Write the `result` line of an answer that is done: `turn.completed` for Codex. */
  | { readonly result: 'success' }
  /**
   * Codex alone: write an `error` line and a `turn.failed` line with this
   * message, and end with 1.
   */
  | { readonly fail: string }
  /** Write this on standard error, and end with this code, with no `result` line. */
  | { readonly die: number; readonly stderr: string }
  /** Answer as the real one does with no login on this account, and end with 1. */
  | { readonly loggedOut: true };

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
  /** The fake's own program, by its absolute path: `claude.cmd` or `codex.cmd` on Windows. */
  readonly program: string;
  /** Say what the fake does on its next start, and every start after it. */
  script(steps: readonly Step[]): Promise<void>;
  /** Every start the fake took, in order. */
  calls(): Promise<readonly Call[]>;
  /** Forget every session, as an Agent does when its session files are gone. */
  forget(): Promise<void>;
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
const known = join(here, 'sessions.jsonl');
const sessions = existsSync(known) ? readFileSync(known, 'utf8').split('\\n') : [];
if (named('--resume') !== undefined && !sessions.includes(session)) {
  const error = 'No conversation found with session ID: ' + session;
  process.stderr.write(error + '\\n');
  write({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [error], session_id: session });
  process.exit(1);
}
if (named('--session-id') !== undefined) appendFileSync(known, session + '\\n');
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
  } else if ('loggedOut' in step) {
    const said = 'Not logged in \u00b7 Please run /login';
    write({ type: 'assistant', message: { model: '<synthetic>', type: 'message', role: 'assistant', content: [{ type: 'text', text: said }], stop_reason: 'stop_sequence' }, parent_tool_use_id: null, session_id: session, error: 'authentication_failed', is_api_error_message: true });
    write({ type: 'result', subtype: 'success', is_error: true, result: said, session_id: session, stop_reason: 'stop_sequence', terminal_reason: 'api_error' });
    process.exit(1);
  }
}
`;

/**
 * The fake `codex` itself. Its session is a thread, which it names in its
 * first line, `thread.started`, and a resume names the thread as its last
 * word. Each part of the answer is one whole `agent_message` item: the real
 * one writes no part of a message before it is whole. The `error` item of the
 * first turn is a warning the real one writes too, and is not the answer.
 */
const FAKE_CODEX = `import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8');
appendFileSync(join(here, 'calls.jsonl'), JSON.stringify({ argv, stdin, cwd: process.cwd() }) + '\\n');

const write = (line) => process.stdout.write(JSON.stringify(line) + '\\n');
const known = join(here, 'sessions.jsonl');
const sessions = existsSync(known) ? readFileSync(known, 'utf8').split('\\n') : [];
const resuming = argv[0] === 'exec' && argv[1] === 'resume';
const thread = resuming ? argv.at(-1) : randomUUID();
if (resuming && !sessions.includes(thread)) {
  process.stderr.write('Reading prompt from stdin...\\n');
  process.stderr.write('Error: thread/resume: thread/resume failed: no rollout found for thread id ' + thread + ' (code -32600)\\n');
  process.exit(1);
}
if (!resuming) appendFileSync(known, thread + '\\n');
const steps = JSON.parse(readFileSync(join(here, 'script.json'), 'utf8'));

process.stderr.write('Reading prompt from stdin...\\n');
write({ type: 'thread.started', thread_id: thread });
write({ type: 'turn.started' });
write({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Skill descriptions were shortened to fit the skills context budget.' } });
let item = 1;
for (const step of steps) {
  if ('say' in step) {
    write({ type: 'item.completed', item: { id: 'item_' + item++, type: 'agent_message', text: step.say } });
  } else if ('waitFor' in step) {
    while (!existsSync(step.waitFor)) await new Promise((done) => setTimeout(done, 20));
  } else if ('result' in step) {
    write({ type: 'turn.completed', usage: { input_tokens: 18420, cached_input_tokens: 0, output_tokens: 6, reasoning_output_tokens: 0 } });
  } else if ('fail' in step) {
    const message = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: step.fail } });
    write({ type: 'error', message });
    write({ type: 'turn.failed', error: { message } });
    process.exit(1);
  } else if ('die' in step) {
    process.stderr.write(step.stderr + '\\n');
    process.exit(step.die);
  } else if ('loggedOut' in step) {
    const refused = 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses';
    process.stderr.write('ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized\\n');
    write({ type: 'error', message: 'Reconnecting... 1/5 (' + refused + ')' });
    write({ type: 'item.completed', item: { id: 'item_' + item++, type: 'error', message: 'Falling back from WebSockets to HTTPS transport. ' + refused } });
    write({ type: 'error', message: refused });
    write({ type: 'turn.failed', error: { message: refused } });
    process.exit(1);
  }
}
`;

/**
 * A fake `claude`, alone on PATH with nothing else, so that a command finds no
 * real Agent the test did not ask for. Until a test says otherwise, it answers
 * "Ahoy." and is done.
 */
export function fakeClaude(t: TestContext): Promise<FakeAgent> {
  return fakeAgent(t, 'claude', FAKE_CLAUDE);
}

/**
 * A fake `codex`, alone on PATH with nothing else, as `fakeClaude` is. Until
 * a test says otherwise, it answers "Ahoy." and is done.
 */
export function fakeCodex(t: TestContext): Promise<FakeAgent> {
  return fakeAgent(t, 'codex', FAKE_CODEX);
}

/** A fake Agent of this name, from this Node program, alone on PATH. */
async function fakeAgent(t: TestContext, name: string, source: string): Promise<FakeAgent> {
  const scratch = await makeHome(t);
  const bin = join(scratch, 'bin');
  const home = join(scratch, 'operator');
  await mkdir(bin);
  await mkdir(home);
  const program = join(bin, `fake-${name}.mjs`);
  await writeFile(program, source);
  await writeFile(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${program}' "$@"\n`);
  await chmod(join(bin, name), 0o755);
  await writeFile(join(bin, `${name}.cmd`), `@"${process.execPath}" "${program}" %*\r\n`);
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
    program: join(bin, process.platform === 'win32' ? `${name}.cmd` : name),
    script,
    calls: async () => {
      const text = await readFile(join(bin, 'calls.jsonl'), 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Call);
    },
    forget: () => rm(join(bin, 'sessions.jsonl'), { force: true }),
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
