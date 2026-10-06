/**
 * How the command line looks in a terminal: colour, and rows in aligned
 * columns under a header.
 *
 * Colour is `styleText` from `node:util`, which looks at the stream it is
 * for: a pipe gets none, NO_COLOR gets none, and FORCE_COLOR asks for it. No
 * package is added for it. Columns are the other half: they line up only when
 * stdout is a TTY. Piped, a row is the tab-separated line it always was, with
 * no header, so that `cut` and `awk` keep working.
 */
import { stripVTControlCharacters, styleText } from 'node:util';

/** The prefix of a refusal or an error, which goes to stderr. */
export function refusalPrefix(): string {
  return styleText('red', 'firstmate:', { stream: process.stderr });
}

/** A group name in the short help, for the stream the help goes to. */
export function groupName(name: string, stream: NodeJS.WriteStream): string {
  return styleText('bold', name, { stream });
}

/** A word that says all is well, in green on stdout. */
export function good(word: string): string {
  return styleText('green', word, { stream: process.stdout });
}

/** A word that says something is wrong, in red on stdout. */
export function bad(word: string): string {
  return styleText('red', word, { stream: process.stdout });
}

/** One row of a table: its cells, and the line it prints as when piped. */
export type Row = {
  /** What each column holds. A cell may carry colour; the padding ignores it. */
  readonly cells: readonly string[];
  /** The whole line piped. Without it, the cells joined by tabs. */
  readonly plain?: string;
};

/** The width of a cell as it shows, which is not its length once it carries colour. */
function shown(cell: string): number {
  return stripVTControlCharacters(cell).length;
}

/**
 * Print rows. On a TTY: a header, then every row with its columns padded to
 * the widest cell. Otherwise: each row as its plain line, with no header.
 */
export function printRows(header: readonly string[], rows: readonly Row[]): void {
  if (process.stdout.isTTY !== true) {
    for (const row of rows) console.log(row.plain ?? row.cells.join('\t'));
    return;
  }
  if (rows.length === 0) return;
  const widths = header.map((title, at) =>
    Math.max(shown(title), ...rows.map((row) => shown(row.cells[at] ?? ''))),
  );
  const last = header.length - 1;
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, at) => (at === last ? cell : cell + ' '.repeat((widths[at] ?? 0) - shown(cell))))
      .join('  ')
      .trimEnd();
  console.log(styleText('bold', line(header), { stream: process.stdout }));
  for (const row of rows) console.log(line(row.cells));
}
