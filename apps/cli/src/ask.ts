/**
 * firstmate ask: the Mate from a terminal.
 *
 * It runs the operator's own Agent in the Place the Mate settings name,
 * prints the answer on standard output as it arrives, and keeps the
 * Conversation where the App's Recents read it. A Conversation it continues
 * resumes with what its head names, whatever the settings
 * say now, so a change of settings never breaks an older Conversation. The
 * Conversation's ID goes to standard error, so the answer on standard output
 * stays clean for a script. It needs no running Host: the
 * Mate is the App's, and this is the same Mate with no window (ADR-0031).
 */
import { askMate, hear } from '@firstmate/core/ask-mate';
import { refusalPrefix } from './terminal.ts';

/** How an answer ended: whole, failed, or stopped with Ctrl+C. */
type Answered = 'done' | 'failed' | 'stopped';

/**
 * Ask the Mate this question, in a new Conversation or in the one this ID
 * names, print the answer as it arrives, and say how it ended. A refusal
 * before the Agent starts is thrown, and keeps nothing.
 */
export async function askAndPrint(
  home: string,
  question: string,
  conversation?: string,
): Promise<Answered> {
  const asking = await askMate(home, question, conversation);
  console.error(asking.id);
  const stop = (): void => asking.run.stop();
  process.once('SIGINT', stop);
  let lastPart = '';
  let end: Awaited<ReturnType<typeof hear>>;
  try {
    end = await hear(home, asking, (part) => {
      lastPart = part;
      process.stdout.write(part);
    });
  } finally {
    process.off('SIGINT', stop);
  }
  if (lastPart !== '' && !lastPart.endsWith('\n')) process.stdout.write('\n');
  if (end.kind === 'failed') console.error(`${refusalPrefix()} ${end.sentence}`);
  return end.kind;
}
