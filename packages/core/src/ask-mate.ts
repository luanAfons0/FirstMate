/**
 * Asking the Mate: start a Conversation or continue one, run the Agent that
 * answers it, hear the answer as it arrives, and keep it once it ends.
 *
 * The App's Mate panel and `firstmate ask` both ask through here, so the two
 * read the same Mate settings and keep the same Conversations, and a
 * Conversation started in one goes on in the other (ADR-0031). A new
 * Conversation takes the Agent, model, effort, Place and program the Mate
 * settings name now. A Conversation that goes on resumes with the Agent, the
 * Place, the model, the effort and the program its head names, whatever the
 * settings say now, so a change of settings never breaks an older Conversation.
 *
 * The Agent runs on the operator's account and can read `runtime.json`, so
 * the Host's token is hidden in everything shown and kept here.
 */
import { tuningOf, type MateRun } from './agents.ts';
import { runAgent, type AgentEnd, type AgentEvent, type AgentRun } from './agent-run.ts';
import {
  addMessage,
  nameSession,
  readConversation,
  startConversation,
  type Head,
} from './conversations.ts';
import { withContext } from './mate-context.ts';
import { allPlaces, type Place } from './places.ts';
import { refuse, sentenceOf } from './refusal.ts';
import { readRuntimeFile } from './runtime.ts';
import { mateOf, matePlace, readSettings } from './settings.ts';

/** What a new Conversation would start with: the Mate settings, with every default in force. */
type MateChoice = Omit<MateRun, 'place'> & { readonly place: Place };

/**
 * What the Mate settings choose now. No `mate` key is the default Agent with
 * its own defaults, in the default Place. A damaged setting throws, as it
 * fails every command.
 */
export function mateChoice(home: string): MateChoice {
  const settings = readSettings(home);
  const mate = mateOf(settings);
  // The settings refuse a Place that is not there, so this one is.
  const named = matePlace(mate);
  const place = allPlaces(settings.places).find((one) => one.name === named);
  if (place === undefined) throw new Error(`The Place ${named} of the Mate settings is not there.`);
  return { agent: mate.agent, place, ...tuningOf(mate) };
}

/** A Conversation, as it is now, and the run of the Agent that answers its newest question. */
type Asking = { readonly id: string; readonly head: Head; readonly run: AgentRun };

/**
 * Ask the Mate this question, in a new Conversation or in the one this ID
 * names. A refusal before the Agent starts is thrown, and keeps nothing. The
 * run's events hide the Host's token.
 */
export async function askMate(
  home: string,
  question: string,
  conversation?: string,
): Promise<Asking> {
  const hide = hider(home);
  const asking =
    conversation === undefined
      ? await begin(home, question, hide)
      : await resume(home, conversation, question, hide);
  return { ...asking, run: { events: hidden(asking.run.events, hide), stop: asking.run.stop } };
}

/** What the Host's token is shown as, wherever the Agent said it. */
const TOKEN_MARK = "[the Host's token]";

/**
 * Hide the Host's token in what the Mate shows and keeps. The Agent runs on
 * the operator's account and can read `runtime.json`, so it may say the token;
 * no Conversation and no printed answer ever holds it. With no runtime file,
 * there is no token to hide.
 */
function hider(home: string): (text: string) => string {
  const token = readRuntimeFile(home)?.token;
  return token === undefined ? (text) => text : (text) => text.replaceAll(token, TOKEN_MARK);
}

/** The Agent's events, with the token hidden in every part of the answer and every sentence. */
async function* hidden(
  events: AsyncIterable<AgentEvent>,
  hide: (text: string) => string,
): AsyncGenerator<AgentEvent> {
  for await (const event of events) {
    if (event.kind === 'text') yield { ...event, text: hide(event.text) };
    else if (event.kind === 'failed') yield { ...event, sentence: hide(event.sentence) };
    else yield event;
  }
}

/**
 * Hear the answer to the newest question: hand each part to `heard` as it
 * arrives, then keep the answer with its Conversation and say how it ended.
 * A run that ends with no word of how, or that throws, failed, in one
 * sentence. A Conversation that cannot be written throws once the answer is
 * whole, so the caller says so.
 */
export async function hear(
  home: string,
  asking: Asking,
  heard: (part: string) => void,
): Promise<AgentEnd> {
  let answer = '';
  let end: AgentEnd | undefined;
  try {
    for await (const event of asking.run.events) {
      if (event.kind === 'text') {
        answer += event.text;
        heard(event.text);
      } else {
        end = event;
      }
    }
  } catch (fault) {
    end = { kind: 'failed', sentence: sentenceOf(fault) };
  }
  end ??= { kind: 'failed', sentence: 'The Agent ended with nothing to say about how.' };
  keepAnswer(home, asking.id, answer, end);
  return end;
}

/**
 * Keep the answer to the newest question, once the run has ended: whole,
 * stopped with the part that arrived, or failed with its one sentence. The
 * Agent session the run named is kept with the Conversation, for the next
 * message to resume. A first run that ended before its answer began is the
 * exception: the Agent may keep no session of it, so the Conversation keeps
 * none, and its next message starts a new session rather than fail to resume.
 */
function keepAnswer(home: string, id: string, answer: string, end: AgentEnd): void {
  const began = end.kind === 'done' || answer !== '';
  const resumed = readConversation(home, id).session !== undefined;
  if (end.session !== undefined && (began || resumed)) nameSession(home, id, end.session);
  const when = new Date().toISOString();
  if (end.kind === 'done') {
    addMessage(home, id, { who: 'agent', text: answer, when });
  } else if (end.kind === 'stopped') {
    addMessage(home, id, { who: 'agent', text: answer, when, ended: 'stopped' });
  } else {
    addMessage(home, id, { who: 'agent', text: answer, when, ended: 'failed', why: end.sentence });
  }
}

/**
 * Start a new Conversation, with what the Mate settings choose. The Agent
 * hears the Mate's context before the question; the Conversation keeps the
 * question alone, and its head what the Conversation started with.
 */
async function begin(
  home: string,
  question: string,
  hide: (text: string) => string,
): Promise<Asking> {
  const choice = mateChoice(home);
  const run = await runAgent({ ...choice, question: withContext(home, question, hide) });
  const started = { ...choice, place: choice.place.name };
  const id = startConversation(home, started, hide(question));
  return { id, head: readConversation(home, id), run };
}

/**
 * Continue a Conversation: resume its Agent session, with the Agent, the
 * Place, the model, the effort and the program its head names, whatever the
 * Mate settings say now. The session holds the Mate's context already, so the
 * question goes alone. A Conversation that holds no session yet, because its
 * first answer never began, starts a new one with the same, and sends the
 * context again. The question is kept once the Agent has started.
 */
async function resume(
  home: string,
  id: string,
  question: string,
  hide: (text: string) => string,
): Promise<Asking> {
  const head = readConversation(home, id);
  const place = allPlaces(readSettings(home).places).find((one) => one.name === head.place);
  if (place === undefined) {
    throw refuse(
      'missing',
      `the ${head.place} Place of Conversation ${id} is gone. ` +
        'Add the Place again, or start a new Conversation.',
    );
  }
  const run = await runAgent({
    agent: head.agent,
    place,
    ...(head.session === undefined
      ? { question: withContext(home, question, hide) }
      : { question, session: head.session }),
    ...tuningOf(head),
  });
  addMessage(home, id, { who: 'operator', text: hide(question), when: new Date().toISOString() });
  return { id, head, run };
}
