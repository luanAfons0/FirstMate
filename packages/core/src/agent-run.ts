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
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { AGENT_NAMES, cannotResume, type Agent, type MateRun } from './agents.ts';
import { parseObject } from './json-object.ts';
import type { Place } from './places.ts';
import { findOnPath, isProgram, killTree, pathOf } from './programs.ts';
import { refuse } from './refusal.ts';
import { findInside, WSL_EXE } from './wsl.ts';

/**
 * What one run of the Agent is asked: what the Mate runs, in its Place, with
 * the question, and the session to resume, if any.
 */
export type AgentRequest = Omit<MateRun, 'place'> & {
  /** The Place the Agent runs in. */
  readonly place: Place;
  /** The question, sent on standard input: on a new session, after the Mate's context. */
  readonly question: string;
  /** The Agent's own session to resume, or nothing to start a new one. */
  readonly session?: string;
};

/** What the Agent says while it runs. A run ends with exactly one of the last three. */
export type AgentEvent =
  /** The next part of the answer, ready to be shown after the parts before it. */
  | { readonly kind: 'text'; readonly text: string }
  /** The answer is whole. */
  | { readonly kind: 'done'; readonly session?: string }
  /** The answer ended early, for the reason this one sentence gives. */
  | { readonly kind: 'failed'; readonly sentence: string; readonly session?: string }
  /** The answer ended because it was stopped. */
  | { readonly kind: 'stopped'; readonly session?: string };

/** How a run ended: the last of its events. */
export type AgentEnd = Exclude<AgentEvent, { readonly kind: 'text' }>;

/** One run of the Agent, under way. */
export type AgentRun = {
  /** What the Agent says, in order, until it ends. */
  readonly events: AsyncIterable<AgentEvent>;
  /** End the Agent's whole process tree. The events end with `stopped`. */
  stop(): void;
};

/**
 * The command that logs each Agent in, in a terminal of the Place it runs in.
 * Neither logs in from a run with no terminal, so the Mate names it instead.
 */
const LOGIN: Readonly<Record<Agent, string>> = {
  claude: 'claude auth login',
  codex: 'codex login',
};

/** The one sentence that says an Agent is not logged in, and how to log it in. */
function notLoggedIn(agent: Agent, place: string): string {
  return (
    `${AGENT_NAMES[agent]} in the ${place} Place is not logged in. ` +
    `Run ${LOGIN[agent]} there, then ask again.`
  );
}

/** What a text block is joined to the one before it with: a new paragraph. */
const BETWEEN_BLOCKS = '\n\n';

/**
 * Start the Agent on this question, in its Place. It refuses before it starts
 * anything when the Agent's program is not there. In a `wsl` Place the
 * Agent runs inside the distribution, in the home directory of its user, as
 * a Plugin Server runs there (ADR-0021); `--exec` hands it its words with no
 * shell between, as a program on this machine gets them.
 */
export async function runAgent(request: AgentRequest): Promise<AgentRun> {
  const { place } = request;
  const { argv, read } = request.agent === 'codex' ? codex(request) : claude(request);
  const child =
    place.kind === 'wsl'
      ? start(
          WSL_EXE,
          [
            ...['-d', place.distribution, '--cd', place.home, '--exec'],
            ...[await programInside(request, place.distribution), ...argv],
          ],
          homedir(),
        )
      : start(programOf(request), argv, homedir());
  child.stdin?.end(request.question);
  let stopped = false;
  return {
    events: read(child, request.place.name, () => stopped),
    stop: () => {
      stopped = true;
      killTree(child, 'SIGTERM');
    },
  };
}

/** How one Agent is started, and how its JSON lines are read as events. */
type Invocation = {
  readonly argv: readonly string[];
  readonly read: (
    child: ChildProcess,
    place: string,
    wasStopped: () => boolean,
  ) => AsyncGenerator<AgentEvent>;
};

/**
 * Claude, in its own non-interactive mode. A new session gets an ID the Mate
 * makes, so the Conversation knows it before Claude says a word.
 */
function claude(request: AgentRequest): Invocation {
  const session = request.session ?? randomUUID();
  const which = request.session === undefined ? '--session-id' : '--resume';
  // No --permission-mode: Claude approves no tool, so it edits no file and
  // runs no command while nobody is asked.
  const argv = [
    ...['-p', '--output-format', 'stream-json', '--verbose', which, session],
    ...(request.model === undefined ? [] : ['--model', request.model]),
    ...(request.effort === undefined ? [] : ['--effort', request.effort]),
  ];
  return { argv, read: (child, ...rest) => readClaude(child, session, ...rest) };
}

/**
 * Codex, with `codex exec`. Its sandbox is read-only, so it edits no file and
 * runs nothing that writes. `exec resume` takes no `--sandbox`, so a resume
 * sets the same sandbox through its config, and the thread is its last word,
 * after `--`, so it is never read as a flag. A new thread gets the ID Codex
 * makes, and names in its first line.
 */
function codex(request: AgentRequest): Invocation {
  const tuning = [
    ...(request.model === undefined ? [] : ['-m', request.model]),
    ...(request.effort === undefined ? [] : ['-c', `model_reasoning_effort=${request.effort}`]),
  ];
  const argv =
    request.session === undefined
      ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', ...tuning]
      : [
          ...['exec', 'resume', '--json', '--skip-git-repo-check'],
          ...['-c', 'sandbox_mode=read-only', ...tuning, '--', request.session],
        ];
  return { argv, read: (child, ...rest) => readCodex(child, request.session, ...rest) };
}

/** Whether this process runs on Windows, where an Agent is found and started its own way. */
const ON_WINDOWS = process.platform === 'win32';

/**
 * The Agent's program: the one the Mate settings name, when they name one,
 * and otherwise the one of the Agent's own name on PATH: on Windows its
 * `.exe`, or the `.cmd` an npm install leaves (ADR-0019). A program the
 * settings name that is not there is refused, and PATH is not searched in its
 * place, so the Agent the operator chose is the one that runs or none.
 */
function programOf(request: AgentRequest): string {
  const { agent, place, program } = request;
  if (program !== undefined) {
    if (isProgram(program)) return program;
    throw notFound(agent, place.name, program);
  }
  const found = findOnPath(ON_WINDOWS ? [`${agent}.exe`, `${agent}.cmd`] : [agent]);
  if (found !== undefined) return found;
  throw notFound(agent, place.name, undefined, pathOf(process.env));
}

/**
 * The Agent's program inside a `wsl` Place's distribution: the one the Mate
 * settings name, or the one of the Agent's own name on the PATH there.
 */
async function programInside(request: AgentRequest, distribution: string): Promise<string> {
  const { agent, place, program } = request;
  const look = await findInside(distribution, program ?? agent);
  if ('found' in look) return look.found;
  throw notFound(agent, place.name, program, look.path);
}

/**
 * The refusal of an Agent that is not where the Mate looked: the program, the
 * Place, where it looked, and the PATH it searched, which in a `wsl` Place is
 * often not the one a terminal there has, and so is worth reading.
 */
function notFound(agent: Agent, place: string, program?: string, path = ''): Error {
  const where =
    program === undefined
      ? `on the PATH of the ${place} Place, which is ${path === '' ? 'empty' : path}`
      : `at ${program} in the ${place} Place`;
  return refuse(
    'missing',
    `cannot find ${agent} ${where}. ` +
      `Install ${AGENT_NAMES[agent]} there, or set "program" in the Mate settings to where it is.`,
  );
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
  let loggedOut = false;
  let result: Record<string, unknown> | undefined;
  if (child.stdout !== null) {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const event = parseObject(line);
      if (event?.['type'] === 'system' && typeof event['session_id'] === 'string') {
        session = event['session_id'];
      } else if (event?.['type'] === 'assistant' && event['is_api_error_message'] === true) {
        // An error of Claude's own, written as a message, is not the answer.
        // Its `result` line says it again, for the sentence of the failure.
        loggedOut ||= event['error'] === 'authentication_failed';
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
  } else if (loggedOut) {
    yield { kind: 'failed', sentence: notLoggedIn('claude', place), session };
  } else {
    yield { kind: 'failed', sentence: claudeFailed(result, code, said, place), session };
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
  if (CLAUDE_NO_SESSION.test(reason)) return cannotResume('claude', place);
  return `Claude stopped before its answer was done: ${reason.replace(/[.\s]*$/, '')}.`;
}

/**
 * Codex's JSON lines, read as events. Its first line, `thread.started`, names
 * the thread, which is the Conversation's session. Each `agent_message` item
 * is a part of the answer; an `error` item is a warning, not the answer.
 * `turn.completed` says the answer is whole, and `turn.failed` or an `error`
 * line says why it is not. A resume keeps the thread it asked for.
 */
async function* readCodex(
  child: ChildProcess,
  asked: string | undefined,
  place: string,
  wasStopped: () => boolean,
): AsyncGenerator<AgentEvent> {
  const ended = ending(child);
  let session = asked;
  let parts = 0;
  let completed = false;
  let error: string | undefined;
  if (child.stdout !== null) {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const event = parseObject(line);
      const type = event?.['type'];
      if (type === 'thread.started' && typeof event?.['thread_id'] === 'string') {
        session ??= event['thread_id'];
      } else if (type === 'item.completed') {
        const { type: kind, text } = (event?.['item'] ?? {}) as Record<string, unknown>;
        if (kind === 'agent_message' && typeof text === 'string' && text !== '') {
          yield { kind: 'text', text: parts === 0 ? text : `${BETWEEN_BLOCKS}${text}` };
          parts += 1;
        }
      } else if (type === 'turn.completed') {
        completed = true;
      } else if (type === 'turn.failed') {
        const failure = (event?.['error'] ?? {}) as Record<string, unknown>;
        error = codexMessage(failure['message']) ?? error;
      } else if (type === 'error') {
        error ??= codexMessage(event?.['message']);
      }
    }
  }
  const { code, said } = await ended;
  const named = session === undefined ? {} : { session };
  if (wasStopped()) {
    yield { kind: 'stopped', ...named };
  } else if (completed && error === undefined && code === 0) {
    yield { kind: 'done', ...named };
  } else {
    const reason = error ?? (said !== '' ? said : `it ended with code ${String(code)}`);
    yield { kind: 'failed', sentence: codexFailed(reason, place), ...named };
  }
}

/**
 * What Codex says in an error: often the whole error of its model's API, as
 * JSON, whose own message is the one sentence worth reading.
 */
function codexMessage(message: unknown): string | undefined {
  if (typeof message !== 'string' || message === '') return undefined;
  const inner = (parseObject(message)?.['error'] ?? {}) as Record<string, unknown>;
  const said = inner['message'];
  return typeof said === 'string' && said !== '' ? said : message;
}

/**
 * What Codex says on stderr when it holds no thread of the ID it was asked to
 * resume: its files are gone, or it is another account's.
 */
const CODEX_NO_SESSION = /no rollout found for thread id/;

/**
 * What Codex says when its model's API refuses it for want of a login: no
 * key and no ChatGPT account on this account, or a login that ran out.
 */
const CODEX_NO_LOGIN = /\b401 Unauthorized\b/;

/** The one sentence that says why Codex's answer ended early. */
function codexFailed(reason: string, place: string): string {
  if (CODEX_NO_LOGIN.test(reason)) return notLoggedIn('codex', place);
  if (CODEX_NO_SESSION.test(reason)) return cannotResume('codex', place);
  const plain = reason.replace(/^Error:\s*/, '').replace(/[.\s]*$/, '');
  return `Codex stopped before its answer was done: ${plain}.`;
}
