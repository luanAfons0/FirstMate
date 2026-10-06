/**
 * `firstmate setup`: a short conversation that sets FirstMate up.
 *
 * It holds the conversation and nothing else. Each step calls the same code
 * the plain command calls, so a refusal has the same words in both places,
 * and `setup` keeps no state of its own. Each step is written when it is
 * answered, not at the end, so a later failure or Ctrl-C keeps what finished.
 * It adds and never removes: `remove`, `revoke` and `unbind` stay the only
 * ways to take something away.
 *
 * It asks, in order: the Shelf and the Places, the import of a 1.x install,
 * the Official Plugins with a Place for each, Grants, Shortcuts, and whether
 * the App starts at logon (ADR-0024).
 */
import {
  addPlace,
  bindShortcut,
  checkKeys,
  checkKeysFree,
  checkShortcutPath,
  givePermission,
  installPlugin,
  listPlaces,
  moveShelf,
} from '@firstmate/core/commands';
import { readConfig } from '@firstmate/core/config';
import { holdsOneX } from '@firstmate/core/import-1x';
import { OFFICIAL_PLUGINS } from '@firstmate/core/official-plugins';
import { onTerminal, openPrompt, type Prompt } from './prompt.ts';
import { refusalPrefix } from './terminal.ts';
import { readRegistry } from '@firstmate/core/registry';
import { appHere, logonIsOn, turnLogonOn } from './install-app.ts';
import { bringAcross } from './one-x.ts';
import { reloadHost } from './running-host.ts';
import { readSettings } from '@firstmate/core/settings';
import { SHELF_VARIABLE } from '@firstmate/core/shelf';
import { shortcutAddress } from '@firstmate/core/shortcut';

/** What one run of `setup` changed so far. */
type Changes = {
  /** One line for each thing done, for the summary. */
  readonly done: string[];
  /** Whether a step failed and was left for the next one to carry on after. */
  failed: boolean;
};

/** Clack, which frames `setup` on a terminal and is loaded only there. */
type Clack = typeof import('@clack/prompts');

/** Run the conversation, and give back the exit code. */
export async function setup(): Promise<number> {
  const changes: Changes = { done: [], failed: false };
  // On a terminal setup opens with a title and closes with a summary in the
  // same frame as its questions; a pipe gets the plain lines (ADR-0025).
  // Clack is loaded only then, so that a pipe loads none of it.
  const framed: Clack | undefined = onTerminal() ? await import('@clack/prompts') : undefined;
  framed?.intro('firstmate setup');
  const prompt = openPrompt(() => {
    if (framed !== undefined) {
      summarise(changes, framed);
      framed.cancel('setup stopped. The steps it finished are kept.');
    } else {
      process.stdout.write('\n');
      summarise(changes, framed);
      console.error(`${refusalPrefix()} setup stopped. The steps it finished are kept.`);
    }
    process.exit(130);
  });
  try {
    await askShelf(prompt, changes);
    await askPlaces(prompt, changes);
    await askImport(prompt, changes);
    await askPlugins(prompt, changes);
    await askGrants(prompt, changes);
    await askShortcuts(prompt, changes);
    await askLogon(prompt, changes);
    await reload(changes);
  } finally {
    prompt.close();
    summarise(changes, framed);
    framed?.outro(changes.failed ? 'setup finished, and a step failed.' : 'setup is done.');
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
      console.error(`${refusalPrefix()} ${sentence(fault)}`);
    }
  }
}

/**
 * Which WSL distributions to add as Places, one after another, until Enter.
 * A distribution is asked about only where there is one to have: on Windows,
 * and inside WSL. Its Place is named after it, as `debian` for `Debian`.
 */
async function askPlaces(prompt: Prompt, changes: Changes): Promise<void> {
  if (process.platform !== 'win32' && (process.env['WSL_DISTRO_NAME'] ?? '') === '') return;
  const { home } = readConfig();
  console.log('The Places:');
  for (const place of listPlaces(home)) console.log(`  ${place.name}  (${place.kind})`);
  for (;;) {
    const distribution = await prompt.text(
      'A WSL distribution to add as a Place, as in Debian, or press Enter to finish:',
      '',
    );
    if (distribution === '') return;
    const name = distribution
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    try {
      const place = await addPlace(home, name, 'wsl', [distribution]);
      console.log(`firstmate: added the wsl Place ${place.name}`);
      changes.done.push(`added the wsl Place ${place.name}`);
    } catch (fault) {
      console.error(`${refusalPrefix()} ${sentence(fault)}`);
    }
  }
}

/**
 * Whether to bring a 1.x install across, from each `wsl` Place that holds one
 * and holds no Plugin of 2.0 yet. It is `import`, word for word.
 */
async function askImport(prompt: Prompt, changes: Changes): Promise<void> {
  const { home } = readConfig();
  const rows = readRegistry(home);
  for (const place of listPlaces(home)) {
    if (rows.some((row) => row.place === place.name) || !holdsOneX(place)) continue;
    if (!(await prompt.confirm(`${place.name} holds a 1.x install. Import it?`, true))) continue;
    try {
      const imported = await bringAcross(home, place, (question) => prompt.confirm(question, true));
      changes.done.push(`imported ${imported.plugins.length} Plugin(s) from ${place.name}`);
      if (imported.refused.length > 0) changes.failed = true;
    } catch (fault) {
      console.error(`${refusalPrefix()} ${sentence(fault)}`);
      changes.failed = true;
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
  const chosen = await prompt.choose({
    heading: 'The Official Plugins:',
    question: 'Which should be installed?',
    choices: OFFICIAL_PLUGINS.map((plugin) => ({
      label: plugin.name,
      hint: plugin.description,
      ...(registered.has(plugin.name) ? { taken: 'installed' } : {}),
    })),
    takes: 'many',
  });
  for (const at of chosen) {
    const plugin = OFFICIAL_PLUGINS[at];
    if (plugin === undefined) continue;
    // Only a Place the Plugin runs in is offered, so that nothing is fetched
    // where it would only go Stopped.
    const places = listPlaces(readConfig().home).filter((place) =>
      plugin.places.includes(place.kind),
    );
    const place = await askPlace(prompt, plugin.name, places);
    if (place === undefined) {
      console.error(
        `${refusalPrefix()} ${plugin.name} runs in a ${plugin.places.join(' or ')} Place, and there ` +
          'is none. Add one, then run setup again.',
      );
      changes.failed = true;
      continue;
    }
    console.log(`firstmate: fetching ${plugin.name} from ${plugin.url}`);
    try {
      // The config is read again for each one, because the Shelf step can
      // have just moved the Shelf.
      const row = await installPlugin(readConfig(), plugin.name, undefined, place);
      console.log(`firstmate: installed ${row.name} at ${row.directory}, in ${row.place}`);
      changes.done.push(`installed ${row.name}`);
    } catch (fault) {
      console.error(`${refusalPrefix()} could not install ${plugin.name}: ${sentence(fault)}`);
      changes.failed = true;
    }
  }
}

/**
 * The Place to install one Official Plugin in: the only one it can run in,
 * with no question, or the one the operator picks among several.
 */
async function askPlace(
  prompt: Prompt,
  plugin: string,
  places: readonly { readonly name: string }[],
): Promise<string | undefined> {
  if (places.length < 2) return places[0]?.name;
  const [at] = await prompt.choose({
    heading: `The Places ${plugin} can run in:`,
    question: `Which should ${plugin} go in?`,
    choices: places.map((place) => ({ label: place.name })),
    takes: 'one',
  });
  return at === undefined ? undefined : places[at]?.name;
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

    const chosen = await prompt.choose({
      heading: `The Plugins ${row.name} may call:`,
      question: `Which may ${row.name} call?`,
      choices: others.map((name) => ({
        label: name,
        ...(row.grants.includes(name) ? { taken: 'granted' } : {}),
      })),
      takes: 'many',
    });
    for (const at of chosen) {
      const to = others[at];
      if (to === undefined) continue;
      givePermission(home, row.name, to);
      console.log(`firstmate: granted ${row.name} the right to call ${to}'s tools.`);
      changes.done.push(`${row.name} may call ${to}`);
    }
  }
}

/**
 * Shortcuts to bind, one after another, until Enter at the keys. The keys,
 * the Plugin and the path are each checked as `bind` checks them, and a
 * refusal asks for that one answer again. The App picks a Shortcut up with
 * no restart (ADR-0013).
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
      console.error(`${refusalPrefix()} ${sentence(fault)}`);
      continue;
    }

    const [at] = await prompt.choose({
      heading: `The Plugins ${keys} can open:`,
      question: `Which should ${keys} open?`,
      choices: plugins.map((name) => ({ label: name })),
      takes: 'one or none',
    });
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
      console.error(`${refusalPrefix()} ${sentence(fault)}`);
    }
  }
}

/**
 * Whether the App starts at logon. It is asked only where the App is
 * installed and does not start at logon yet, and it is off until the
 * operator says yes. It writes the same entry the App writes from its Tray
 * and its Settings View.
 */
async function askLogon(prompt: Prompt, changes: Changes): Promise<void> {
  const here = await appHere();
  if (here === undefined) return;
  if (here.installed === undefined) {
    console.log('firstmate: the App is not installed yet. Run firstmate desktop to install it.');
    return;
  }
  if (await logonIsOn(here)) return;
  if (!(await prompt.confirm('Start FirstMate at logon?', false))) return;
  try {
    await turnLogonOn(here.installed);
    changes.done.push('FirstMate starts at logon');
  } catch (fault) {
    console.error(`${refusalPrefix()} ${sentence(fault)}`);
    changes.failed = true;
  }
}

/**
 * Ask the running Host to pick up what this run changed, as every plain
 * command does. It asks nothing of the operator: a reload leaves every Plugin
 * Server that was not added or removed alone. With no Host running there is
 * nothing to ask: the App reads the files as they are when it starts.
 */
async function reload(changes: Changes): Promise<void> {
  if (changes.done.length === 0) return;
  try {
    await reloadHost(readConfig().home);
  } catch (fault) {
    console.error(`${refusalPrefix()} ${sentence(fault)}`);
    changes.failed = true;
  }
}

/**
 * Say what changed, and nothing when nothing did: in a note on a terminal,
 * and in plain lines anywhere else.
 */
function summarise(changes: Changes, framed: Clack | undefined): void {
  if (changes.done.length === 0) return;
  const done = changes.done.splice(0);
  if (framed !== undefined) {
    framed.note(done.join('\n'), 'setup changed');
    return;
  }
  console.log('firstmate: setup changed:');
  for (const change of done) console.log(`  ${change}`);
}

/** What went wrong, as the sentence it carries. */
function sentence(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}
