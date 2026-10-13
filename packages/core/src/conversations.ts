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
 * The App's Recents lists them, the one said in last first, and opens one
 * again whole. A file that cannot be read is listed with the sentence that
 * says why, so one damaged Conversation never hides the others.
 *
 * These are FirstMate's own data, not a Plugin's (ADR-0005). The Agent keeps
 * its own session files where it keeps them, and nothing here touches them.
 */
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isAgent, isModelName, type Agent, type MateRun } from './agents.ts';
import { parseObject } from './json-object.ts';
import { refuse } from './refusal.ts';

/** The directory the Conversations are in, inside the home directory. */
const CONVERSATIONS_DIRECTORY = 'conversations';

/** The ending of a Conversation's file name, after its ID. */
const SUFFIX = '.jsonl';

/** The longest a title is, in characters. */
const TITLE_LENGTH = 60;

/**
 * The first line of a Conversation: what it is, and what it resumes. It keeps
 * what the Mate runs as the Conversation started, so the next message runs
 * the same: the Agent, the Place it runs in, and the model, the effort and the
 * program when they were chosen.
 */
export type Head = MateRun & {
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
  return join(directoryOf(home), `${id}${SUFFIX}`);
}

/** The shape of a Conversation ID: a UUID, as the Mate makes one. Nothing else names a file. */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Do this with the file of the Conversation this ID names. An ID that is not
 * one, or that names no file, is refused in one sentence, so that no other
 * file is ever reached through an ID.
 */
function withFile<T>(home: string, id: string, act: (path: string) => T): T {
  try {
    if (!CONVERSATION_ID.test(id)) throw new Error('not an ID');
    return act(fileOf(home, id));
  } catch {
    throw refuse('missing', `there is no Conversation ${id}.`);
  }
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
  head: Omit<Head, 'session' | 'title' | 'when'>,
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

/**
 * Read a Conversation's head, once every line of its file is read. An ID with
 * no Conversation is refused, and a line that cannot be read fails this
 * Conversation alone, in one sentence that names its file.
 */
export function readConversation(home: string, id: string): Head {
  return readWhole(home, id).head;
}

/** A whole Conversation: its head, and every message in the order it was said. */
type Whole = { readonly head: Head; readonly messages: readonly Message[] };

/**
 * Read a whole Conversation, as Recents opens it again. It is refused as
 * `readConversation` refuses it.
 */
export function readWhole(home: string, id: string): Whole {
  const path = fileOf(home, id);
  const text = withFile(home, id, (file) => readFileSync(file, 'utf8'));
  const read = text
    .trimEnd()
    .split('\n')
    .map((line, index) => {
      const value = parseObject(line);
      if (value === undefined || !(index === 0 ? isHead(value) : isMessage(value))) {
        throw new Error(`Line ${index + 1} of the Conversation at ${path} cannot be read.`);
      }
      return value;
    });
  const [head, ...messages] = read;
  return { head: head as Head, messages: messages as Message[] };
}

/** One Conversation, as Recents lists it. */
export type Listed =
  | {
      readonly kind: 'read';
      readonly id: string;
      readonly title: string;
      readonly agent: Agent;
      /** The model it started with, absent for the Agent's own default. */
      readonly model?: string;
      /** When it was said in last: its newest message, as an ISO 8601 time. */
      readonly when: string;
    }
  | {
      readonly kind: 'unreadable';
      readonly id: string;
      /** Why it cannot be read, in one sentence. */
      readonly why: string;
      /** When its file last changed, as an ISO 8601 time. */
      readonly when: string;
    };

/**
 * Every Conversation in the home directory, the one said in last first. One
 * that cannot be read is listed with the sentence that says why, and the
 * others list as they are. A file that is not named as a Conversation is not
 * one, and is passed over.
 */
export function listConversations(home: string): Listed[] {
  let names: string[];
  try {
    names = readdirSync(directoryOf(home));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  return names
    .filter((name) => name.endsWith(SUFFIX) && CONVERSATION_ID.test(idOfFile(name)))
    .map((name) => listedOf(home, idOfFile(name)))
    .sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
}

function idOfFile(name: string): string {
  return name.slice(0, -SUFFIX.length);
}

function listedOf(home: string, id: string): Listed {
  try {
    const { head, messages } = readWhole(home, id);
    return {
      kind: 'read',
      id,
      title: head.title,
      agent: head.agent,
      ...(head.model === undefined ? {} : { model: head.model }),
      when: messages.at(-1)?.when ?? head.when,
    };
  } catch (fault) {
    const why = fault instanceof Error ? fault.message : String(fault);
    let when = new Date(0).toISOString();
    try {
      when = statSync(fileOf(home, id)).mtime.toISOString();
    } catch {
      // Gone since it was listed: it sorts last, and says why.
    }
    return { kind: 'unreadable', id, why, when };
  }
}

/**
 * Delete a Conversation: FirstMate's own file of it, and nothing else. The
 * Agent keeps its own session where it keeps it, so the Agent's own program
 * can still resume it (ADR-0031). An ID that names no Conversation is refused.
 */
export function deleteConversation(home: string, id: string): void {
  withFile(home, id, (file) => rmSync(file));
}

function isHead(line: Record<string, unknown>): boolean {
  return (
    isAgent(line['agent']) &&
    typeof line['place'] === 'string' &&
    (line['model'] === undefined ||
      (typeof line['model'] === 'string' && isModelName(line['model']))) &&
    (line['effort'] === undefined || typeof line['effort'] === 'string') &&
    (line['program'] === undefined || typeof line['program'] === 'string') &&
    (line['session'] === undefined || typeof line['session'] === 'string') &&
    typeof line['title'] === 'string' &&
    typeof line['when'] === 'string'
  );
}

function isMessage(line: Record<string, unknown>): boolean {
  return (
    (line['who'] === 'operator' || line['who'] === 'agent') &&
    typeof line['text'] === 'string' &&
    typeof line['when'] === 'string' &&
    (line['ended'] === undefined || line['ended'] === 'stopped' || line['ended'] === 'failed') &&
    (line['why'] === undefined || typeof line['why'] === 'string')
  );
}

/** Write these lines as a Conversation file, whole, for this user alone. */
function writeWhole(path: string, lines: readonly unknown[]): void {
  const pending = `${path}.pending`;
  const text = lines.map((line) => `${JSON.stringify(line)}\n`).join('');
  writeFileSync(pending, text, { mode: 0o600 });
  renameSync(pending, path);
}
