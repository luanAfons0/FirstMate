/**
 * Questions in a terminal, for `setup`: ask for text, confirm yes or no, and
 * choose from a numbered list.
 *
 * It uses `node:readline` and nothing else (ADR-0011). A prompt library would
 * need a raw TTY, and a raw TTY is what a black-box test cannot drive; plain
 * lines can be typed by a person and piped by a script alike. So input that is
 * not a TTY is read one answer per line, and when it ends before every
 * question is answered, the question throws `ENDED_EARLY` at once rather than
 * waiting for a line that will never come.
 */
import { createInterface } from 'node:readline';

/** The sentence `setup` stops with when its input ends too early. */
const ENDED_EARLY = 'setup ended before it had every answer.';

/** The three kinds of question, and the way to stop asking. */
export type Prompt = {
  /** Ask for text. Enter gives back the default. */
  text(question: string, fallback: string): Promise<string>;
  /** Ask yes or no. Enter gives back the default. */
  confirm(question: string, fallback: boolean): Promise<boolean>;
  /**
   * Ask for numbers from 1 to `count`: one, or many split by spaces or commas.
   * Enter chooses nothing. What comes back is zero-based, in the order typed.
   */
  choose(question: string, count: number, many: boolean): Promise<readonly number[]>;
  /** Stop reading the input, so that the process can end. */
  close(): void;
};

/**
 * Questions asked on this process's own terminal, or on whatever is piped
 * into it. `interrupted` runs on Ctrl-C.
 */
export function openPrompt(interrupted: () => void): Prompt {
  const tty = process.stdin.isTTY === true;
  const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  const waiting: ((line: string | undefined) => void)[] = [];
  const queued: string[] = [];
  let ended = false;

  lines.on('line', (line) => {
    const next = waiting.shift();
    if (next === undefined) queued.push(line);
    else next(line);
  });
  lines.on('close', () => {
    ended = true;
    for (const next of waiting.splice(0)) next(undefined);
  });
  // A terminal in raw mode turns Ctrl-C into a key, which readline reports;
  // anywhere else it is a signal.
  lines.on('SIGINT', interrupted);
  process.once('SIGINT', interrupted);

  /** The next line, or a throw when there will be none. */
  async function answer(question: string): Promise<string> {
    process.stdout.write(`${question} `);
    const line =
      queued.shift() ??
      (ended ? undefined : await new Promise<string | undefined>((got) => waiting.push(got)));
    if (line === undefined) {
      process.stdout.write('\n');
      throw new Error(ENDED_EARLY);
    }
    // A person's own Enter ends the line on a terminal. A piped answer is not
    // echoed, so the line is ended here to keep what is printed readable.
    if (!tty) process.stdout.write(`${line}\n`);
    return line.trim();
  }

  /** Ask until the answer reads, saying why each one that does not was refused. */
  async function until<T>(question: string, read: (typed: string) => T | string): Promise<T> {
    for (;;) {
      const got = read(await answer(question));
      if (typeof got !== 'string') return got;
      console.error(`firstmate: ${got}`);
    }
  }

  return {
    text: async (question, fallback) => {
      const typed = await answer(fallback === '' ? question : `${question} [${fallback}]`);
      return typed === '' ? fallback : typed;
    },
    confirm: (question, fallback) =>
      until(`${question} [${fallback ? 'Y/n' : 'y/N'}]`, (typed) => {
        const said = typed.toLowerCase();
        if (said === '') return { yes: fallback };
        if (said === 'y' || said === 'yes') return { yes: true };
        if (said === 'n' || said === 'no') return { yes: false };
        return `${typed} is not an answer here. Say yes or no.`;
      }).then((read) => read.yes),
    choose: (question, count, many) =>
      until(question, (typed) => {
        if (typed === '') return { chosen: [] };
        const chosen: number[] = [];
        for (const part of typed.split(/[\s,]+/).filter((word) => word !== '')) {
          const number = Number(part);
          if (!/^[0-9]+$/.test(part) || number < 1 || number > count) {
            return count === 1
              ? `${part} is not on the list. Type 1, or press Enter for none.`
              : `${part} is not on the list. Type a number from 1 to ${count}.`;
          }
          if (!chosen.includes(number - 1)) chosen.push(number - 1);
        }
        if (!many && chosen.length > 1) return 'Choose one number, or press Enter for none.';
        return { chosen };
      }).then((read) => read.chosen),
    close: () => lines.close(),
  };
}
