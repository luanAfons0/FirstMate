/**
 * firstmate ask: the Mate from a terminal.
 *
 * It runs the operator's own Agent in the Place the Mate settings name,
 * prints the answer on standard output as it arrives, and keeps the
 * Conversation where the App's Recents read it. A Conversation it continues
 * resumes with the Agent and the Place its head names, whatever the settings
 * say now, so a change of settings never breaks an older Conversation. The
 * Conversation's ID goes to standard error, so the answer on standard output
 * stays clean for a script. It needs no running Host: the
 * Mate is the App's, and this is the same Mate with no window (ADR-0031).
 */
import type { AgentEvent } from '@firstmate/core/agent-run';
import { askMate, keepAnswer } from '@firstmate/core/ask-mate';
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
  const { id, run } = await askMate(home, question, conversation);
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
  if (last === undefined || last.kind === 'text') {
    throw new Error('The Agent ended with nothing to say about how.');
  }
  keepAnswer(home, id, answer, last);
  if (last.kind === 'failed') console.error(`${refusalPrefix()} ${last.sentence}`);
  return last.kind;
}
