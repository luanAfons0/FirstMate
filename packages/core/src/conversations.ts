/**
 * The Conversations: every chat with the Mate, kept in the home directory so
 * that the App and the terminal both read them, and both after a restart.
 *
 * One Conversation is one file in `conversations/`, named by an ID the Mate
 * makes, and written for this user alone. It is JSON lines: the first line is
 * the head, which says which Agent answers it, where, and which Agent session
 * it resumes, and every later line is one message. A message is appended, so
 * a Conversation is never written whole while an answer arrives.
 *
 * These are FirstMate's own data, not a Plugin's (ADR-0005). The Agent keeps
 * its own session files where it keeps them, and nothing here touches them.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from './agent-run.ts';

/** The directory the Conversations are in, inside the home directory. */
const CONVERSATIONS_DIRECTORY = 'conversations';

/** The longest a title is, in characters. */
const TITLE_LENGTH = 60;

/** The first line of a Conversation: what it is, and what it resumes. */
type Head = {
  readonly agent: Agent;
  /** The Place the Agent runs in, by name. */
  readonly place: string;
  /** The Agent's own session, which the next message resumes, once it is known. */
  readonly session?: string;
  /** The first line of the first message, cut to a short length. */
  readonly title: string;
  /** When the Conversation was made, as an ISO 8601 time. */
  readonly when: string;
};

/** One message of a Conversation. */
export type Message = {
  /** Who said it: the operator, or the Agent. */
  readonly who: 'operator' | 'agent';
  readonly text: string;
  /** When it was said, as an ISO 8601 time. */
  readonly when: string;
  /** For an answer that ended early: whether it was stopped or failed. */
  readonly ended?: 'stopped' | 'failed';
  /** For an answer that failed: why, in one sentence. */
  readonly why?: string;
};

function directoryOf(home: string): string {
  return join(home, CONVERSATIONS_DIRECTORY);
}

function fileOf(home: string, id: string): string {
  return join(directoryOf(home), `${id}.jsonl`);
}

/** The title of a Conversation: the first line of its first message, cut short. */
function titleOf(question: string): string {
  const [first = ''] = question.trim().split(/\r?\n/);
  return Array.from(first.trim()).slice(0, TITLE_LENGTH).join('');
}

/**
 * Start a Conversation with the operator's first message, and give back its
 * ID. Its head and that message are written together, through a rename, so
 * a Conversation is never there without its first message.
 */
export function startConversation(
  home: string,
  head: Pick<Head, 'agent' | 'place'>,
  question: string,
): string {
  const id = randomUUID();
  const when = new Date().toISOString();
  const first: Message = { who: 'operator', text: question, when };
  mkdirSync(directoryOf(home), { recursive: true, mode: 0o700 });
  writeWhole(fileOf(home, id), [{ ...head, title: titleOf(question), when }, first]);
  return id;
}

/** Add one message to the end of a Conversation. */
export function addMessage(home: string, id: string, message: Message): void {
  appendFileSync(fileOf(home, id), `${JSON.stringify(message)}\n`, { mode: 0o600 });
}

/**
 * Keep the Agent session a Conversation resumes, once the Agent has named it.
 * The head is the first line, so the file is written again whole, through a
 * rename, with every message as it was.
 */
export function nameSession(home: string, id: string, session: string): void {
  const path = fileOf(home, id);
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  const head = JSON.parse(lines[0] ?? '{}') as Head;
  if (head.session === session) return;
  const rest = lines.slice(1).map((line) => JSON.parse(line) as unknown);
  writeWhole(path, [{ ...head, session }, ...rest]);
}

/** Write these lines as a Conversation file, whole, for this user alone. */
function writeWhole(path: string, lines: readonly unknown[]): void {
  const pending = `${path}.pending`;
  const text = lines.map((line) => `${JSON.stringify(line)}\n`).join('');
  writeFileSync(pending, text, { mode: 0o600 });
  renameSync(pending, path);
}
