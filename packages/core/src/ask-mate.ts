/**
 * Asking the Mate: start a Conversation or continue one, run the Agent that
 * answers it, and keep the answer once it ends.
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
import { runAgent, type Agent, type AgentEvent, type AgentRun } from './agent-run.ts';
import {
  addMessage,
  nameSession,
  readConversation,
  startConversation,
  type Head,
} from './conversations.ts';
import { allPlaces, DEFAULT_PLACE, type Place } from './places.ts';
import { refuse } from './refusal.ts';
import { readRuntimeFile } from './runtime.ts';
import { chosen, readSettings } from './settings.ts';

/** What a new Conversation would start with: the Mate settings, with every default in force. */
type MateChoice = {
  readonly agent: Agent;
  readonly place: Place;
  readonly model?: string;
  readonly effort?: string;
  readonly program?: string;
};

/**
 * What the Mate settings choose now. No `mate` key is Claude with its own
 * defaults, in the default Place. A damaged setting throws, as it fails every
 * command.
 */
export function mateChoice(home: string): MateChoice {
  const settings = readSettings(home);
  const mate = settings.mate ?? { agent: 'claude' };
  // The settings refuse a Place that is not there, so this one is.
  const named = chosen(mate.place) ?? DEFAULT_PLACE;
  const place = allPlaces(settings.places).find((one) => one.name === named);
  if (place === undefined) throw new Error(`The Place ${named} of the Mate settings is not there.`);
  const model = chosen(mate.model);
  const effort = chosen(mate.effort);
  const program = chosen(mate.program);
  return {
    agent: mate.agent,
    place,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(program === undefined ? {} : { program }),
  };
}

/** A Conversation, as it is now, and the run of the Agent that answers its newest question. */
type Asking = { readonly id: string; readonly head: Head; readonly run: AgentRun };

/**
 * Ask the Mate this question, in a new Conversation or in the one this ID
 * names. A refusal before the Agent starts is thrown, and keeps nothing.
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
 * Keep the answer to the newest question, once the run has ended: whole,
 * stopped with the part that arrived, or failed with its one sentence. The
 * Agent session the run named is kept with the Conversation, for the next
 * message to resume. A first run that ended before its answer began is the
 * exception: the Agent may keep no session of it, so the Conversation keeps
 * none, and its next message starts a new session rather than fail to resume.
 */
export function keepAnswer(
  home: string,
  id: string,
  answer: string,
  end: Exclude<AgentEvent, { kind: 'text' }>,
): void {
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
 * Start a new Conversation, with what the Mate settings choose. The head
 * keeps what the Conversation started with.
 */
async function begin(
  home: string,
  question: string,
  hide: (text: string) => string,
): Promise<Asking> {
  const { agent, place, model, effort, program } = mateChoice(home);
  const run = await runAgent({
    agent,
    place,
    question,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(program === undefined ? {} : { program }),
  });
  const started = {
    agent,
    place: place.name,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(program === undefined ? {} : { program }),
  };
  const id = startConversation(home, started, hide(question));
  return { id, head: readConversation(home, id), run };
}

/**
 * Continue a Conversation: resume its Agent session, with the Agent, the
 * Place, the model, the effort and the program its head names, whatever the
 * Mate settings say now. A Conversation that holds no session yet, because
 * its first answer never began, starts a new one with the same. The question
 * is kept once the Agent has started.
 */
async function resume(
  home: string,
  id: string,
  question: string,
  hide: (text: string) => string,
): Promise<Asking> {
  const head = readConversation(home, id);
  const settings = readSettings(home);
  const place = allPlaces(settings.places).find((one) => one.name === head.place);
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
    question,
    ...(head.session === undefined ? {} : { session: head.session }),
    ...(head.model === undefined ? {} : { model: head.model }),
    ...(head.effort === undefined ? {} : { effort: head.effort }),
    ...(head.program === undefined ? {} : { program: head.program }),
  });
  addMessage(home, id, { who: 'operator', text: hide(question), when: new Date().toISOString() });
  return { id, head, run };
}
