/**
 * Questions in a terminal, for `setup`: ask for text, confirm yes or no, and
 * choose from a list.
 *
 * There are two forms of one interface (ADR-0025). On a terminal, where both
 * stdin and stdout are a TTY, the questions are `@clack/prompts`: arrow keys,
 * a list to tick, and the default shown. Anywhere else they are `node:readline`
 * and plain lines, which a person can type and a script can pipe alike. A
 * prompt library needs a raw TTY, and a raw TTY is what a black-box test cannot
 * drive, so the piped form is the one the suite proves, and a person checks
 * the other by hand.
 *
 * Piped input is read one answer per line, and when it ends before every
 * question is answered, the question throws `ENDED_EARLY` at once rather than
 * waiting for a line that will never come.
 */
import { createInterface } from 'node:readline';
import { refusalPrefix } from './terminal.ts';

/** The sentence `setup` stops with when its input ends too early. */
const ENDED_EARLY = 'setup ended before it had every answer.';

/** One line of a list to choose from. */
type Choice = {
  /** The name on the line. */
  readonly label: string;
  /** What it is, beside the name. */
  readonly hint?: string;
  /** Why it is on the list but cannot be chosen, as `installed`. */
  readonly taken?: string;
};

/** A question to choose from a list. */
type Choosing = {
  /** The line above the list, as `The Official Plugins:`. */
  readonly heading: string;
  /** The question, as `Which should be installed?`. */
  readonly question: string;
  /** Every line of the list, in order, those that cannot be chosen too. */
  readonly choices: readonly Choice[];
  /** Many, one, or one or none. */
  readonly takes: 'many' | 'one' | 'one or none';
};

/** The three kinds of question, and the way to stop asking. */
export type Prompt = {
  /** Ask for text. Enter gives back the default. */
  text(question: string, fallback: string): Promise<string>;
  /** Ask yes or no. Enter gives back the default. */
  confirm(question: string, fallback: boolean): Promise<boolean>;
  /**
   * Show a list and ask which of it. What comes back is where each chosen one
   * sits in `choices`. A list with nothing to choose is shown and asks nothing.
   */
  choose(choosing: Choosing): Promise<readonly number[]>;
  /** Stop reading the input, so that the process can end. */
  close(): void;
};

/**
 * Whether a person is at a terminal that can draw: stdin and stdout are both a
 * TTY, and TERM is not `dumb`, which says the cursor cannot move.
 */
export function onTerminal(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['TERM'] !== 'dumb'
  );
}

/**
 * Questions asked on this process's own terminal, or on whatever is piped
 * into it. `interrupted` runs on Ctrl-C.
 */
export function openPrompt(interrupted: () => void): Prompt {
  return onTerminal() ? clackPrompt(interrupted) : linePrompt(interrupted);
}

/**
 * The terminal form. Ctrl-C inside a question is a key clack reports as a
 * cancel; between questions it is a signal. Both stop at once. Clack is
 * loaded here and nowhere sooner, so a command that asks nothing loads none
 * of it (ADR-0025).
 */
function clackPrompt(interrupted: () => void): Prompt {
  process.once('SIGINT', interrupted);
  const loading = import('@clack/prompts');

  /** The answer, or a stop at once when the question was cancelled. */
  async function answered<T>(value: T): Promise<Exclude<T, symbol>> {
    const { isCancel } = await loading;
    if (isCancel(value)) {
      interrupted();
      throw new Error('setup stopped.');
    }
    return value as Exclude<T, symbol>;
  }

  return {
    text: async (question, fallback) => {
      const { text } = await loading;
      const typed = await answered(
        await text(
          fallback === ''
            ? { message: question }
            : { message: question, placeholder: fallback, defaultValue: fallback },
        ),
      );
      return typed.trim() || fallback;
    },
    confirm: async (question, fallback) => {
      const { confirm } = await loading;
      return answered(await confirm({ message: question, initialValue: fallback }));
    },
    choose: async ({ heading, question, choices, takes }) => {
      const { multiselect, note, select } = await loading;
      if (choices.every((choice) => choice.taken !== undefined)) {
        note(choices.map((choice) => `${choice.label} (${choice.taken})`).join('\n'), heading);
        return [];
      }
      const options = choices.map((choice, at) => ({
        value: at,
        label: choice.label,
        ...(choice.taken === undefined ? {} : { disabled: true }),
        ...((choice.taken ?? choice.hint) === undefined
          ? {}
          : { hint: choice.taken ?? choice.hint }),
      }));
      if (takes === 'many') {
        return answered(await multiselect({ message: question, options, required: false }));
      }
      const none = { value: -1, label: 'none' };
      const chosen = await answered(
        await select({
          message: question,
          options: takes === 'one' ? options : [...options, none],
        }),
      );
      return chosen < 0 ? [] : [chosen];
    },
    close: () => process.off('SIGINT', interrupted),
  };
}

/** The piped form: one answer per line, and a list of numbers to type. */
function linePrompt(interrupted: () => void): Prompt {
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
      console.error(`${refusalPrefix()} ${got}`);
    }
  }

  /** Numbers from 1 to `count`, one or many, zero-based in the order typed. */
  function numbers(question: string, count: number, many: boolean): Promise<number[]> {
    return until(question, (typed) => {
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
    }).then((read) => read.chosen);
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
    choose: async ({ heading, question, choices, takes }) => {
      // Only the choices that can be chosen are numbered, from 1.
      const offered: number[] = [];
      const width = Math.max(
        0,
        ...choices.filter((choice) => choice.hint !== undefined).map((one) => one.label.length),
      );
      console.log(heading);
      for (const [at, choice] of choices.entries()) {
        const named =
          choice.hint === undefined
            ? choice.label
            : `${choice.label.padEnd(width)}  ${choice.hint}`;
        if (choice.taken !== undefined) {
          console.log(`      ${named} (${choice.taken})`);
          continue;
        }
        offered.push(at);
        console.log(`  ${String(offered.length).padStart(2)}. ${named}`);
      }
      if (offered.length === 0) return [];

      const typing = {
        many: ' Type their numbers, or press Enter for none:',
        'one or none': ' Type its number, or press Enter for none:',
        one: '',
      }[takes];
      for (;;) {
        const chosen = await numbers(`${question}${typing}`, offered.length, takes === 'many');
        // A list that takes exactly one asks again, and says nothing, on Enter.
        if (chosen.length > 0 || takes !== 'one') {
          return chosen.map((at) => offered[at]).filter((at) => at !== undefined);
        }
      }
    },
    close: () => lines.close(),
  };
}
