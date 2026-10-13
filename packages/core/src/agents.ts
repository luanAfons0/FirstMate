/**
 * The Agents the Mate can run, as data: their names, the efforts and models
 * each knows, the shape of a model name, and what the Mate runs one with.
 *
 * It is data alone, as the Places are (`places.ts`), so the settings, the
 * Conversations and the App's pages read it without loading how an Agent is
 * started (`agent-run.ts`). A new Agent is one more entry here, and one more
 * way to start it there (ADR-0031).
 */

/** Every Agent the Mate can run. */
export const AGENTS = ['claude', 'codex'] as const;

/** One Agent the Mate can run: the program on the operator's own account. */
export type Agent = (typeof AGENTS)[number];

/** The Agent the Mate runs when the Mate settings choose none. */
export const DEFAULT_AGENT: Agent = 'claude';

/** Whether a value names an Agent the Mate can run. */
export function isAgent(value: unknown): value is Agent {
  return AGENTS.some((agent) => agent === value);
}

/** The name each Agent is known by in a sentence the operator reads. */
export const AGENT_NAMES: Readonly<Record<Agent, string>> = {
  claude: 'Claude',
  codex: 'Codex',
};

/**
 * The levels of effort each Agent knows: Claude's `--effort`, and Codex's
 * `model_reasoning_effort`. Codex's are the ones codex-cli 0.147.0 hands to
 * its models, and which a model does not take, its answer refuses in one
 * sentence of its own.
 */
export const EFFORTS: Readonly<Record<Agent, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
};

/**
 * The models the Settings View offers for each Agent: Claude's own aliases,
 * which follow its newest models, and the models codex-cli 0.147.0 lists on
 * 2026-10-13. They are offered, not required: any model name is accepted, so
 * a new model works on the day the Agent knows it (ADR-0031).
 */
export const KNOWN_MODELS: Readonly<Record<Agent, readonly string[]>> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
};

/**
 * The shape of a model name: letters, digits and `.`, `_`, `-`, `:`, `/`,
 * `@`, `[` and `]`, as in `opus`, `claude-sonnet-4-5[1m]` or a Bedrock ID. It
 * starts with a letter or a digit, so it is never read as a flag, and it holds
 * nothing cmd.exe reads as its own, because a model reaches cmd.exe as an
 * argument when the Agent is a `.cmd` (ADR-0019).
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;

/** Whether a value can be handed to an Agent as the name of a model. */
export function isModelName(value: string): boolean {
  return MODEL_NAME.test(value);
}

/** The fields of what the Mate runs, in the order the Settings View sends them. */
export const MATE_FIELDS = ['agent', 'model', 'effort', 'place', 'program'] as const;

/**
 * What the Mate runs: the Agent, and the model, the effort, the Place by name
 * and the program it runs with. The Mate settings choose it for a new
 * Conversation, and a Conversation's head keeps what it started with. A field
 * that is absent or empty leaves the Agent's own default.
 */
export type MateRun = {
  readonly agent: Agent;
  /** The model the Agent answers with. */
  readonly model?: string;
  /** The effort, one of the Agent's own levels. */
  readonly effort?: string;
  /** The Place the Agent runs in, by name. */
  readonly place?: string;
  /** The absolute path of the Agent's program, for an Agent that is not on PATH. */
  readonly program?: string;
};

/** What the Mate runs, as the Settings View sends it: each field a word, empty for the default. */
export type MateWords = Readonly<Record<(typeof MATE_FIELDS)[number], string>>;

/**
 * One field of what the Mate runs, as the Mate uses it: the value given, or
 * nothing when it is absent or empty, so that the Agent's own default holds.
 */
export function chosen(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** The model, the effort and the program of what the Mate runs, each left out when not chosen. */
export function tuningOf(run: MateRun): Pick<MateRun, 'model' | 'effort' | 'program'> {
  const model = chosen(run.model);
  const effort = chosen(run.effort);
  const program = chosen(run.program);
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(program === undefined ? {} : { program }),
  };
}

/** The words that end the one sentence of a session that cannot be resumed. */
const CANNOT_RESUME =
  'cannot resume the session of this Conversation, so start a new Conversation.';

/** The one sentence that says an Agent holds no session of a Conversation any more. */
export function cannotResume(agent: Agent, place: string): string {
  return `${AGENT_NAMES[agent]} in the ${place} Place ${CANNOT_RESUME}`;
}

/**
 * Whether a failure says the Conversation's session cannot be resumed, so
 * the Mate panel offers a new Conversation beside it.
 */
export function saysCannotResume(sentence: string): boolean {
  return sentence.endsWith(CANNOT_RESUME);
}
