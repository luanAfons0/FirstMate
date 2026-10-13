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
import { allPlaces } from '@firstmate/core/places';
import { refuse } from '@firstmate/core/refusal';
import { readSettings } from '@firstmate/core/settings';
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
  nameSession(home, id, last.session);
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

/** Start a new Conversation, with Claude in the default Place. */
function begin(home: string, question: string): Asking {
  const [place] = allPlaces(readSettings(home).places);
  if (place === undefined) throw new Error('There is no default Place.');
  const run = runAgent({ agent: 'claude', place, question });
  const id = startConversation(home, { agent: 'claude', place: place.name }, question);
  return { id, run };
}

/**
 * Continue a Conversation: resume its Agent session, with the Agent and the
 * Place its head names. The question is kept once the Agent has started.
 */
function resume(home: string, id: string, question: string): Asking {
  const head = readConversation(home, id);
  const place = allPlaces(readSettings(home).places).find((one) => one.name === head.place);
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
  const run = runAgent({ agent: head.agent, place, question, session: head.session });
  addMessage(home, id, { who: 'operator', text: question, when: new Date().toISOString() });
  return { id, run };
}
