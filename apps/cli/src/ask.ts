/**
 * firstmate ask: the Mate from a terminal.
 *
 * It runs the operator's own Agent in the default Place, prints the answer on
 * standard output as it arrives, and keeps the Conversation where the App's
 * Recents read it. The Conversation's ID goes to standard error, so the answer
 * on standard output stays clean for a script. It needs no running Host: the
 * Mate is the App's, and this is the same Mate with no window (ADR-0031).
 */
import { runAgent, type AgentEvent } from '@firstmate/core/agent-run';
import { addMessage, nameSession, startConversation } from '@firstmate/core/conversations';
import { allPlaces } from '@firstmate/core/places';
import { readSettings } from '@firstmate/core/settings';
import { refusalPrefix } from './terminal.ts';

/** How an answer ended: whole, failed, or stopped with Ctrl+C. */
type Answered = 'done' | 'failed' | 'stopped';

/**
 * Ask the Mate this question, and say how the answer ended. A refusal before
 * the Agent starts is thrown, and keeps nothing.
 */
export async function ask(home: string, question: string): Promise<Answered> {
  const [place] = allPlaces(readSettings(home).places);
  if (place === undefined) throw new Error('There is no default Place.');
  const run = runAgent({ agent: 'claude', place, question });
  const id = startConversation(home, { agent: 'claude', place: place.name }, question);
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
