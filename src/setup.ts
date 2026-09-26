/**
 * `firstmate setup`: a short conversation that sets FirstMate up.
 *
 * It holds the conversation and nothing else. Each step calls the same code
 * the plain command calls, so a refusal has the same words in both places,
 * and `setup` keeps no state of its own. Each step is written when it is
 * answered, not at the end, so a later failure or Ctrl-C keeps what finished.
 * It adds and never removes: `remove`, `revoke` and `unbind` stay the only
 * ways to take something away.
 */
import { moveShelf } from './commands.ts';
import { readConfig } from './config.ts';
import { openPrompt, type Prompt } from './prompt.ts';
import { SHELF_VARIABLE } from './shelf.ts';

/** What one run of `setup` changed, one line each, for the summary. */
type Changes = string[];

/** Run the conversation, and give back the exit code. */
export async function setup(): Promise<number> {
  const changes: Changes = [];
  const prompt = openPrompt(() => {
    process.stdout.write('\n');
    summarise(changes);
    console.error('firstmate: setup stopped. The steps it finished are kept.');
    process.exit(130);
  });
  try {
    await askShelf(prompt, changes);
  } finally {
    prompt.close();
    summarise(changes);
  }
  return 0;
}

/**
 * Where a fetched Plugin lands. Enter keeps the Shelf in force; a path is
 * checked as `firstmate shelf` checks it, and a refusal asks again.
 */
async function askShelf(prompt: Prompt, changes: Changes): Promise<void> {
  const { home, shelf } = readConfig();
  for (;;) {
    const answer = await prompt.text('Where should a fetched Plugin land (the Shelf)?', shelf);
    if (answer === shelf) return;
    try {
      const moved = moveShelf(home, answer);
      if (moved.forced !== undefined) {
        console.log(
          `firstmate: ${SHELF_VARIABLE} is set to ${moved.forced}, and wins until it is unset.`,
        );
      }
      if (moved.shelf !== shelf) changes.push(`the Shelf is now ${moved.shelf}`);
      return;
    } catch (fault) {
      console.error(`firstmate: ${fault instanceof Error ? fault.message : String(fault)}`);
    }
  }
}

/** Say what changed, and nothing when nothing did. */
function summarise(changes: Changes): void {
  if (changes.length === 0) return;
  console.log('firstmate: setup changed:');
  for (const change of changes.splice(0)) console.log(`  ${change}`);
}
