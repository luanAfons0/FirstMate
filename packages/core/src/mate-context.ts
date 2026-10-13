/**
 * What the Mate tells the Agent before the first question of a Conversation:
 * a short primer about FirstMate, the Plugins of the Registry, and the
 * operator's own notes in `mate.md`.
 *
 * It goes on standard input, before the question, so it reaches Claude and
 * Codex, on this machine and in a `wsl` Place, the same way, and holds nothing
 * a shell or cmd.exe reads (ADR-0031). It is sent once: a Conversation that
 * goes on resumes the Agent's own session, which holds it already. It is
 * FirstMate's own data: the Registry says where each Plugin is, and no file of
 * a Plugin is read (ADR-0005).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from './registry.ts';

/** The operator's own notes for the Agent, in the home directory. */
const NOTES_FILE = 'mate.md';

/** What FirstMate is, in the words the operator uses, as data. */
const PRIMER: readonly string[] = [
  "FirstMate is a local plugin host. It runs the operator's own tools on their",
  'own machine, and gives each one a process, a page and an address.',
  '',
  'The words FirstMate uses, and the operator uses with you:',
  '- App: the FirstMate program the operator runs. It holds the Host, the Tray and the window.',
  '- Host: the part of the App that runs the Plugins and serves their pages on 127.0.0.1.',
  '- Plugin: a directory the Host runs and serves. It may hold a Plugin Page and a Plugin Server.',
  '- Plugin Page: the web page a Plugin ships, at its address /p/<name>/ on the Host.',
  '- Plugin Server: the MCP server a Plugin ships. Its tools are all the Plugin can do.',
  '- Place: where a Plugin is installed and runs: this machine, or one WSL distribution.',
  "- Registry: the Host's record of every Plugin: its name, its Place, its directory, its Grants.",
  '- Grant: permission for one named Plugin to call the tools of another.',
  '- Shortcut: a key combination the App holds, which opens one Plugin address in a Popup.',
  '- Stopped: a Plugin whose Plugin Server no longer runs, until `firstmate restart <name>`.',
  "- Mate: this chat with you, in the App's window and from `firstmate ask`.",
  '- Conversation: one exchange of messages with the Mate. You keep your own session of it.',
  '',
  'The `firstmate` commands that only read, and what they say:',
  '- firstmate list: every Plugin in the Registry, with its Place and directory.',
  '- firstmate status: whether the Host runs, and the state of each Plugin.',
  '- firstmate logs: what the Host and the Plugin Servers said. `-f` follows it.',
  '- firstmate order: the Plugin Order, the order every list shows the Plugins in.',
  '- firstmate place: every Place, and its kind.',
  '- firstmate help: the help topics. `firstmate --help` names every command.',
  '',
  "You see no Plugin's data. Each Plugin keeps its own data in its own directory,",
  "and the Mate gives you no Plugin Page and no Plugin's tools.",
];

/** The line that opens the context, so the Agent knows where it begins. */
const OPENS = '<firstmate-context>';

/** The line that ends the context. The operator's question follows it. */
const ENDS = '</firstmate-context>';

/**
 * The first message of a new Agent session: the context, ended clearly, then
 * the question, so the Agent knows which part the operator asked. `hide`
 * takes the Host's token out of the context, should `mate.md` hold it.
 */
export function withContext(
  home: string,
  question: string,
  hide: (text: string) => string,
): string {
  return `${hide(context(home))}\n\n${question}`;
}

/** The whole context, from its opening line to its end. */
function context(home: string): string {
  const notes = readNotes(home);
  return [
    OPENS,
    "FirstMate sends this once, before the operator's first question in this Conversation.",
    `It is not the question: the question follows ${ENDS}.`,
    '',
    ...PRIMER,
    '',
    ...plugins(home),
    ...(notes === undefined ? [] : ['', `The operator's own notes, from ${NOTES_FILE}:`, notes]),
    ENDS,
  ].join('\n');
}

/** The Plugins of the Registry now: each one's name, Place, directory and address. */
function plugins(home: string): string[] {
  const rows = readRegistry(home);
  if (rows.length === 0) return ['No Plugin is in the Registry yet.'];
  return [
    'The Plugins in the Registry now:',
    ...rows.map(
      (row) =>
        `- ${row.name}: Place ${row.place}, directory ${row.directory}, address /p/${row.name}/`,
    ),
  ];
}

/**
 * The operator's notes, as they wrote them, with no blank line at their end.
 * No file is no notes; a file that cannot be read is an error to see.
 */
function readNotes(home: string): string | undefined {
  const path = join(home, NOTES_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the Mate's notes at ${path}.`, { cause });
  }
  const trimmed = text.trimEnd();
  return trimmed === '' ? undefined : trimmed;
}
