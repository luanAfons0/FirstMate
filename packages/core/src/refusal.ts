/**
 * A refusal: the sentence a command says when it changes nothing, and the
 * kind of refusal it is.
 *
 * The sentence is for the person at the terminal. The kind is for a script,
 * which reads it as the exit code the command line ends with, so it can tell
 * a name already taken from a name that was never there without reading the
 * sentence. A fault that carries no kind is a failure, not a refusal.
 */

/** Every kind of refusal, in the order their exit codes count up. */
const REFUSALS = ['invalid', 'missing', 'taken'] as const;

/**
 * What kind of refusal one is: a value that is not what it must be, a name
 * that is not there, or a name that is there already.
 */
export type Refusal = (typeof REFUSALS)[number];

/** The error a command throws when it refuses, with its kind on it. */
export function refuse(kind: Refusal, sentence: string, options?: ErrorOptions): Error {
  return Object.assign(new Error(sentence, options), { refusal: kind });
}

/** The kind of refusal a fault is, or nothing when it is a failure. */
export function refusalOf(fault: unknown): Refusal | undefined {
  if (!(fault instanceof Error) || !('refusal' in fault)) return undefined;
  return REFUSALS.find((kind) => kind === fault.refusal);
}
