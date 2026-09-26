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
import { installPlugin, moveShelf } from './commands.ts';
import { readConfig } from './config.ts';
import { OFFICIAL_PLUGINS } from './official-plugins.ts';
import { openPrompt, type Prompt } from './prompt.ts';
import { readRegistry } from './registry.ts';
import { SHELF_VARIABLE } from './shelf.ts';

/** What one run of `setup` changed so far. */
type Changes = {
  /** One line for each thing done, for the summary. */
  readonly done: string[];
  /** Whether the Registry changed, which only a restart of the Host picks up. */
  registry: boolean;
  /** Whether a step failed and was left for the next one to carry on after. */
  failed: boolean;
};

/** Run the conversation, and give back the exit code. */
export async function setup(): Promise<number> {
  const changes: Changes = { done: [], registry: false, failed: false };
  const prompt = openPrompt(() => {
    process.stdout.write('\n');
    summarise(changes);
    console.error('firstmate: setup stopped. The steps it finished are kept.');
    process.exit(130);
  });
  try {
    await askShelf(prompt, changes);
    await askPlugins(prompt, changes);
  } finally {
    prompt.close();
    summarise(changes);
  }
  return changes.failed ? 1 : 0;
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
      if (moved.shelf !== shelf) changes.done.push(`the Shelf is now ${moved.shelf}`);
      return;
    } catch (fault) {
      console.error(`firstmate: ${sentence(fault)}`);
    }
  }
}

/**
 * Which Official Plugins to fetch. One that is in the Registry already, by
 * Plugin Name alone, is shown as installed and is not offered (ADR-0015). A
 * fetch that fails says which and why, and the others go on.
 */
async function askPlugins(prompt: Prompt, changes: Changes): Promise<void> {
  const registered = new Set(readRegistry(readConfig().home).map((row) => row.name));
  const offered = OFFICIAL_PLUGINS.filter((plugin) => !registered.has(plugin.name));
  const width = Math.max(...OFFICIAL_PLUGINS.map((plugin) => plugin.name.length));

  console.log('The Official Plugins:');
  for (const plugin of OFFICIAL_PLUGINS) {
    const at = offered.indexOf(plugin);
    const number = at < 0 ? '   ' : `${String(at + 1).padStart(2)}.`;
    const installed = at < 0 ? ' (installed)' : '';
    console.log(`  ${number} ${plugin.name.padEnd(width)}  ${plugin.description}${installed}`);
  }
  if (offered.length === 0) return;

  const chosen = await prompt.choose(
    'Which should be installed? Type their numbers, or press Enter for none:',
    offered.length,
    true,
  );
  for (const at of chosen) {
    const plugin = offered[at];
    if (plugin === undefined) continue;
    console.log(`firstmate: fetching ${plugin.name} from ${plugin.url}`);
    try {
      // The config is read again for each one, because the Shelf step can
      // have just moved the Shelf.
      const row = await installPlugin(readConfig(), plugin.name);
      console.log(`firstmate: installed ${row.name} at ${row.directory}`);
      changes.done.push(`installed ${row.name}`);
      changes.registry = true;
    } catch (fault) {
      console.error(`firstmate: could not install ${plugin.name}: ${sentence(fault)}`);
      changes.failed = true;
    }
  }
}

/** Say what changed, and nothing when nothing did. */
function summarise(changes: Changes): void {
  if (changes.done.length === 0) return;
  console.log('firstmate: setup changed:');
  for (const change of changes.done.splice(0)) console.log(`  ${change}`);
  if (changes.registry) console.log('firstmate: restart the Host to pick it up.');
  changes.registry = false;
}

/** What went wrong, as the sentence it carries. */
function sentence(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}
