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
import {
  bindShortcut,
  checkKeys,
  checkKeysFree,
  checkShortcutPath,
  givePermission,
  installPlugin,
  moveShelf,
} from './commands.ts';
import { readConfig } from './config.ts';
import { OFFICIAL_PLUGINS } from './official-plugins.ts';
import { openPrompt, type Prompt } from './prompt.ts';
import { readRegistry } from './registry.ts';
import { NO_SYSTEMD, RESTART_COMMAND, restartService, serviceOn, serviceState } from './service.ts';
import { readSettings } from './settings.ts';
import { SHELF_VARIABLE } from './shelf.ts';
import { shortcutAddress } from './shortcut.ts';

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
    await askGrants(prompt, changes);
    await askShortcuts(prompt, changes);
    await askService(prompt, changes);
    await askRestart(prompt, changes);
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

/**
 * Which Plugins each installed Official Plugin that calls others may call.
 * Every Plugin in the Registry but the caller is on the list, official or
 * not. A Grant already given is shown and not offered, and no Grant is ever
 * taken back here: running `setup` again cannot break a Plugin that works.
 */
async function askGrants(prompt: Prompt, changes: Changes): Promise<void> {
  const { home } = readConfig();
  for (const caller of OFFICIAL_PLUGINS.filter((plugin) => plugin.callsOthers)) {
    const rows = readRegistry(home);
    const row = rows.find((candidate) => candidate.name === caller.name);
    if (row === undefined) continue;
    const others = rows.filter((candidate) => candidate !== row).map((other) => other.name);
    if (others.length === 0) continue;
    const offered = others.filter((name) => !row.grants.includes(name));

    console.log(`The Plugins ${row.name} may call:`);
    for (const name of others) {
      const at = offered.indexOf(name);
      console.log(at < 0 ? `      ${name} (granted)` : `  ${String(at + 1).padStart(2)}. ${name}`);
    }
    if (offered.length === 0) continue;

    const chosen = await prompt.choose(
      `Which may ${row.name} call? Type their numbers, or press Enter for none:`,
      offered.length,
      true,
    );
    for (const at of chosen) {
      const to = offered[at];
      if (to === undefined) continue;
      givePermission(home, row.name, to);
      console.log(`firstmate: granted ${row.name} the right to call ${to}'s tools.`);
      changes.done.push(`${row.name} may call ${to}`);
      changes.registry = true;
    }
  }
}

/**
 * Shortcuts to bind, one after another, until Enter at the keys. The keys,
 * the Plugin and the path are each checked as `bind` checks them, and a
 * refusal asks for that one answer again. The Tray picks a Shortcut up with
 * no restart, so a Shortcut is no reason to restart the Host (ADR-0013).
 */
async function askShortcuts(prompt: Prompt, changes: Changes): Promise<void> {
  const { home } = readConfig();
  const plugins = readRegistry(home).map((row) => row.name);
  if (plugins.length === 0) return;

  const bound = readSettings(home).shortcuts ?? [];
  if (bound.length > 0) {
    console.log('The Shortcuts bound now:');
    for (const shortcut of bound) {
      console.log(`  ${shortcut.keys}  opens ${shortcutAddress(shortcut)}`);
    }
  }

  for (;;) {
    const typed = await prompt.text(
      'Keys for a new Shortcut, as in Ctrl+Alt+N, or press Enter to finish:',
      '',
    );
    if (typed === '') return;
    let keys: string;
    try {
      keys = checkKeys(typed);
      checkKeysFree(home, keys);
    } catch (fault) {
      console.error(`firstmate: ${sentence(fault)}`);
      continue;
    }

    console.log(`The Plugins ${keys} can open:`);
    for (const [at, name] of plugins.entries()) {
      console.log(`  ${String(at + 1).padStart(2)}. ${name}`);
    }
    const [at] = await prompt.choose(
      `Which should ${keys} open? Type its number, or press Enter for none:`,
      plugins.length,
      false,
    );
    const plugin = at === undefined ? undefined : plugins[at];
    if (plugin === undefined) continue;

    const path = await askPath(prompt, plugin);
    const shortcut = bindShortcut(home, keys, plugin, path);
    console.log(`firstmate: bound ${shortcut.keys} to open ${shortcutAddress(shortcut)}`);
    changes.done.push(`bound ${shortcut.keys} to open ${shortcutAddress(shortcut)}`);
  }
}

/** The path under a Plugin's address a Shortcut opens. `/` is the Plugin Page. */
async function askPath(prompt: Prompt, plugin: string): Promise<string> {
  for (;;) {
    const typed = await prompt.text(`Which path inside ${plugin} should it open?`, '/');
    const path = typed === '/' ? '' : typed;
    try {
      checkShortcutPath(path, plugin);
      return path;
    } catch (fault) {
      console.error(`firstmate: ${sentence(fault)}`);
    }
  }
}

/**
 * Whether the Host should run as a systemd user service. A service that runs
 * already is not asked about, and a machine with no systemd is told so in the
 * words `service on` uses, and `setup` goes on.
 */
async function askService(prompt: Prompt, changes: Changes): Promise<void> {
  const state = serviceState();
  if (state === 'active') return;
  if (state === 'no-systemd') {
    console.log(`firstmate: ${NO_SYSTEMD}`);
    return;
  }
  if (!(await prompt.confirm('Run the Host as a systemd user service?', true))) return;
  try {
    serviceOn();
    changes.done.push('the Host runs as a systemd user service');
    // A service that was not running starts now, and reads the Registry as
    // it is, so there is nothing left to restart.
    changes.registry = false;
  } catch (fault) {
    console.error(`firstmate: ${sentence(fault)}`);
    changes.failed = true;
  }
}

/**
 * Whether to restart the Host now. It is asked only when the service runs and
 * this run changed the Registry, because the Host reads the Registry only
 * when it starts; a Shortcut or a Shelf needs no restart.
 */
async function askRestart(prompt: Prompt, changes: Changes): Promise<void> {
  if (!changes.registry || serviceState() !== 'active') return;
  if (!(await prompt.confirm('Restart the Host now, so that it picks the changes up?', true))) {
    console.log(`firstmate: restart it when you are ready: ${RESTART_COMMAND}`);
    changes.registry = false;
    return;
  }
  try {
    restartService();
    changes.done.push('restarted the Host');
    changes.registry = false;
  } catch (fault) {
    console.error(`firstmate: ${sentence(fault)}`);
    changes.failed = true;
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
