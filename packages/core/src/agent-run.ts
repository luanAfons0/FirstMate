/**
 * One run of the operator's own Agent: the question in, the answer out as it
 * arrives, and a way to stop it.
 *
 * The Mate holds no model key and makes no network call of its own. It runs
 * the Agent's own program, on the operator's own account, which answers with
 * its own login and its own plan (ADR-0031). Everything that differs between
 * one Agent and another is hidden here: its program, its arguments, the JSON
 * lines it writes, and how a Place starts it. The App and the terminal see a
 * stream of the same few events, so a flag that changes is one change here.
 *
 * The question goes on standard input and never in an argument, and the
 * program is started from a list of words with no shell, so no shell or
 * cmd.exe rule can change what the question means. The Agent runs in its own
 * non-interactive mode with no tool approved, in the operator's home
 * directory, and a stop ends its whole process tree.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Place } from './places.ts';
import { refuse } from './refusal.ts';

/** Every Agent the Mate can run. */
const AGENTS = ['claude'] as const;

/** One Agent the Mate can run: the program on the operator's own account. */
export type Agent = (typeof AGENTS)[number];

/** Whether a value names an Agent the Mate can run. */
export function isAgent(value: unknown): value is Agent {
  return AGENTS.some((agent) => agent === value);
}

/** The name each Agent is known by in a sentence the operator reads. */
const AGENT_NAMES: Readonly<Record<Agent, string>> = { claude: 'Claude' };

/** What one run of the Agent is asked. */
export type AgentRequest = {
  readonly agent: Agent;
  /** The Place the Agent runs in. */
  readonly place: Place;
  /** The question, sent on standard input. */
  readonly question: string;
  /** The Agent's own session to resume, or nothing to start a new one. */
  readonly session?: string;
};

/** What the Agent says while it runs. A run ends with exactly one of the last three. */
export type AgentEvent =
  /** The next part of the answer, ready to be shown after the parts before it. */
  | { readonly kind: 'text'; readonly text: string }
  /** The answer is whole. */
  | { readonly kind: 'done'; readonly session: string }
  /** The answer ended early, for the reason this one sentence gives. */
  | { readonly kind: 'failed'; readonly sentence: string; readonly session: string }
  /** The answer ended because it was stopped. */
  | { readonly kind: 'stopped'; readonly session: string };

/** One run of the Agent, under way. */
export type AgentRun = {
  /** What the Agent says, in order, until it ends. */
  readonly events: AsyncIterable<AgentEvent>;
  /** End the Agent's whole process tree. The events end with `stopped`. */
  stop(): void;
};

/** What a text block is joined to the one before it with: a new paragraph. */
const BETWEEN_BLOCKS = '\n\n';

/**
 * Start the Agent on this question. It refuses before it starts anything when
 * the Agent's program is not there.
 */
export function runAgent(request: AgentRequest): AgentRun {
  const program = findProgram(request.agent, process.env);
  if (program === undefined) {
    throw refuse(
      'missing',
      `cannot find ${request.agent} on the PATH of the ${request.place.name} Place. ` +
        `Install ${AGENT_NAMES[request.agent]}, or put ${request.agent} on the PATH.`,
    );
  }
  const session = request.session ?? randomUUID();
  const which = request.session === undefined ? '--session-id' : '--resume';
  // Claude's own non-interactive mode, with no --permission-mode: it approves
  // no tool, so it edits no file and runs no command while nobody is asked.
  const argv = ['-p', '--output-format', 'stream-json', '--verbose', which, session];
  const child = start(program, argv, homedir());
  child.stdin?.end(request.question);
  let stopped = false;
  return {
    events: readClaude(child, session, request.place.name, () => stopped),
    stop: () => {
      stopped = true;
      killTree(child);
    },
  };
}

/** Whether this process runs on Windows, where a program is found and ended its own way. */
const ON_WINDOWS = process.platform === 'win32';

/**
 * The Agent's program on PATH: on Windows its `.exe`, or the `.cmd` an npm
 * install leaves (ADR-0019), and anywhere else the file of its own name.
 */
function findProgram(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const names = ON_WINDOWS ? [`${name}.exe`, `${name}.cmd`] : [name];
  const directories = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter((one) => one);
  for (const directory of directories) {
    for (const file of names) {
      const path = join(directory, file);
      if (isProgram(path)) return path;
    }
  }
  return undefined;
}

function isProgram(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!ON_WINDOWS) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The characters cmd.exe reads as its own, which a `.cmd` path or argument
 * must not hold. Each word is handed to it inside quotes or holds no space.
 */
const CMD_SPECIAL = /["%^&|<>!\r\n]/;

/**
 * Start a program from a list of words, with no shell. Node starts a `.cmd`
 * file only through cmd.exe (CVE-2024-27980), so that one goes through
 * cmd.exe, and is handed nothing cmd.exe would read as its own (ADR-0019).
 * On Linux it leads a process group of its own, so a stop ends every process
 * under it.
 */
function start(program: string, argv: readonly string[], cwd: string): ChildProcess {
  const stdio = 'pipe';
  if (!program.toLowerCase().endsWith('.cmd')) {
    return spawn(program, argv, { cwd, stdio, detached: !ON_WINDOWS, windowsHide: true });
  }
  const words = [program, ...argv];
  const special = words.find((word) => CMD_SPECIAL.test(word));
  if (special !== undefined) {
    throw new Error(`cmd.exe would read ${special} its own way, so it is not started.`);
  }
  const line = words.map((word) => (word.includes(' ') ? `"${word}"` : word)).join(' ');
  return spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    cwd,
    stdio,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
}

/** End a run's whole process tree: its process group, or on Windows every process under it. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (ON_WINDOWS) {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    // taskkill missing, or the tree already gone: the process itself still goes.
    taskkill.once('error', () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/** How a process ended, and the last thing it said on stderr. */
type Ending = { readonly code: number | null; readonly said: string };

/** Wait for a process to end, keeping the last line it wrote on stderr. */
function ending(child: ChildProcess): Promise<Ending> {
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  return new Promise((done) => {
    child.once('error', (cause) => done({ code: null, said: cause.message }));
    child.once('close', (code) => {
      const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
      done({ code, said: lines.at(-1)?.trim() ?? '' });
    });
  });
}

/**
 * Claude's JSON lines, read as events. Each text block of an `assistant` line
 * is a part of the answer. The `result` line says whether the answer is
 * whole; a process that ends with none failed, mid-answer or before it. The
 * session is the one Claude names, when it names one, so a resume that gives
 * a new session still leaves the Conversation on the one Claude holds.
 */
async function* readClaude(
  child: ChildProcess,
  asked: string,
  place: string,
  wasStopped: () => boolean,
): AsyncGenerator<AgentEvent> {
  const ended = ending(child);
  let session = asked;
  let blocks = 0;
  let result: Record<string, unknown> | undefined;
  if (child.stdout !== null) {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const event = parseLine(line);
      if (event?.['type'] === 'system' && typeof event['session_id'] === 'string') {
        session = event['session_id'];
      } else if (event?.['type'] === 'assistant') {
        for (const text of textBlocks(event['message'])) {
          yield { kind: 'text', text: blocks === 0 ? text : `${BETWEEN_BLOCKS}${text}` };
          blocks += 1;
        }
      } else if (event?.['type'] === 'result') {
        result = event;
      }
    }
  }
  const { code, said } = await ended;
  if (wasStopped()) {
    yield { kind: 'stopped', session };
  } else if (result !== undefined && result['is_error'] !== true && code === 0) {
    yield { kind: 'done', session };
  } else {
    yield { kind: 'failed', sentence: claudeFailed(result, code, said, place), session };
  }
}

/** One line Claude wrote, as a JSON object, or nothing when it is not one. */
function parseLine(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The text blocks of one message Claude wrote, in order. Thinking is not the answer. */
function textBlocks(message: unknown): string[] {
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    const { type, text } = (block ?? {}) as Record<string, unknown>;
    return type === 'text' && typeof text === 'string' && text !== '' ? [text] : [];
  });
}

/**
 * What Claude says, on stderr and in its `result` line, when it holds no
 * session of the ID it was asked to resume: its files are gone, or it is
 * another account's.
 */
const CLAUDE_NO_SESSION = /^No conversation found with session ID/;

/** The one sentence that says why Claude's answer ended early. */
function claudeFailed(
  result: Record<string, unknown> | undefined,
  code: number | null,
  said: string,
  place: string,
): string {
  const errors = result?.['errors'];
  const reason =
    (Array.isArray(errors) && typeof errors[0] === 'string' ? errors[0] : undefined) ??
    (typeof result?.['result'] === 'string' && result['result'] !== ''
      ? result['result']
      : undefined) ??
    (said !== '' ? said : `it ended with code ${String(code)}`);
  if (CLAUDE_NO_SESSION.test(reason)) {
    return (
      `Claude in the ${place} Place cannot resume the session of this Conversation, ` +
      'so start a new Conversation.'
    );
  }
  return `Claude stopped before its answer was done: ${reason.replace(/[.\s]*$/, '')}.`;
}
