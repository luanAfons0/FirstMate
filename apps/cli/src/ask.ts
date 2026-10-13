/**
 * firstmate ask: the Mate from a terminal.
 *
 * It runs the operator's own Agent in the default Place, prints the answer on
 * standard output as it arrives, and keeps the Conversation where the App's
 * Recents read it. A Conversation it continues resumes with the Agent and the
 * Place its head names, whatever the settings say now, so a change of
 * settings never breaks an older Conversation. The Conversation's ID goes to standard error, so the answer
 * on standard output stays clean for a script. It needs no running Host: the
 * Mate is the App's, and this is the same Mate with no window (ADR-0031).
 */
import { runAgent, type AgentEvent, type AgentRun } from '@firstmate/core/agent-run';
import {
  addMessage,
  nameSession,
  readConversation,
  startConversation,
} from '@firstmate/core/conversations';
import { allPlaces, DEFAULT_PLACE } from '@firstmate/core/places';
import { refuse } from '@firstmate/core/refusal';
import { chosen, readSettings } from '@firstmate/core/settings';
import { refusalPrefix } from './terminal.ts';

/** How an answer ended: whole, failed, or stopped with Ctrl+C. */
type Answered = 'done' | 'failed' | 'stopped';

/**
 * Ask the Mate this question, in a new Conversation or in the one this ID
 * names, and say how the answer ended. A refusal before the Agent starts is
 * thrown, and keeps nothing.
 */
export async function ask(
  home: string,
  question: string,
  conversation?: string,
): Promise<Answered> {
  const { id, run } =
    conversation === undefined ? begin(home, question) : resume(home, conversation, question);
  console.error(id);
  const stop = (): void => run.stop();
  process.once('SIGINT', stop);
  let answer = '';
  let last: AgentEvent | undefined;
  try {
    for await (const event of run.events) {
      if (event.kind === 'text') {
        answer += event.text;
        process.stdout.write(event.text);
      } else {
        last = event;
      }
    }
  } finally {
    process.off('SIGINT', stop);
  }
  if (answer !== '' && !answer.endsWith('\n')) process.stdout.write('\n');
  const when = new Date().toISOString();
  if (last === undefined || last.kind === 'text') {
    throw new Error('The Agent ended with nothing to say about how.');
  }
  if (last.session !== undefined) nameSession(home, id, last.session);
  switch (last.kind) {
    case 'done':
      addMessage(home, id, { who: 'agent', text: answer, when });
      return 'done';
    case 'stopped':
      addMessage(home, id, { who: 'agent', text: answer, when, ended: 'stopped' });
      return 'stopped';
    case 'failed':
      addMessage(home, id, {
        who: 'agent',
        text: answer,
        when,
        ended: 'failed',
        why: last.sentence,
      });
      console.error(`${refusalPrefix()} ${last.sentence}`);
      return 'failed';
  }
}

/** A Conversation, and the run of the Agent that answers its newest question. */
type Asking = { readonly id: string; readonly run: AgentRun };

/**
 * Start a new Conversation, with the Agent, model, effort, Place and program
 * the Mate settings name. No `mate` key is Claude with its own defaults, in
 * the default Place. The head keeps what the Conversation started with.
 */
function begin(home: string, question: string): Asking {
  const settings = readSettings(home);
  const mate = settings.mate ?? { agent: 'claude' };
  const places = allPlaces(settings.places);
  const named = chosen(mate.place);
  const place = named === undefined ? places[0] : places.find((one) => one.name === named);
  if (place === undefined) {
    throw refuse(
      'missing',
      `the ${String(named)} Place the Mate settings name is not there. ` +
        'Add the Place, or choose another for the Mate.',
    );
  }
  const model = chosen(mate.model);
  const effort = chosen(mate.effort);
  const program = chosen(mate.program);
  const run = runAgent({
    agent: mate.agent,
    place,
    question,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(program === undefined ? {} : { program }),
  });
  const head = {
    agent: mate.agent,
    place: place.name,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
  const id = startConversation(home, head, question);
  return { id, run };
}

/**
 * Continue a Conversation: resume its Agent session, with the Agent, the
 * Place, the model and the effort its head names. The program the Mate
 * settings name is used only when they name the same Agent in the same Place,
 * because a program is one Agent's, at a path of one Place. The question is
 * kept once the Agent has started.
 */
function resume(home: string, id: string, question: string): Asking {
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
  if (head.session === undefined) {
    throw new Error(`Conversation ${id} holds no Agent session to resume. Start a new one.`);
  }
  const mate = settings.mate;
  const same = mate?.agent === head.agent && (chosen(mate.place) ?? DEFAULT_PLACE) === head.place;
  const program = same ? chosen(mate.program) : undefined;
  const run = runAgent({
    agent: head.agent,
    place,
    question,
    session: head.session,
    ...(head.model === undefined ? {} : { model: head.model }),
    ...(head.effort === undefined ? {} : { effort: head.effort }),
    ...(program === undefined ? {} : { program }),
  });
  addMessage(home, id, { who: 'operator', text: question, when: new Date().toISOString() });
  return { id, run };
}
