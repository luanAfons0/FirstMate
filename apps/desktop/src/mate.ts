/**
 * The Mate, as the App's main process holds it: the Conversation the Mate
 * panel shows, and the run of the Agent that answers it.
 *
 * It asks through `core`, as `firstmate ask` does, so the panel and the
 * terminal read the same Mate settings and keep the same Conversations
 * (ADR-0031). The panel only shows what this holds and asks for what the
 * operator did; it starts nothing itself.
 *
 * One Conversation is shown at a time, and while its answer arrives it takes
 * no other question, so two answers never mix. A new Conversation leaves an
 * answer that still arrives to finish and be kept with its own Conversation.
 * The panel's Conversation is held for as long as the App runs, so the panel
 * opens on it again after it was closed and after a Plugin switch.
 */
import { AGENT_NAMES, type AgentEvent, type AgentRun } from '@firstmate/core/agent-run';
import { askMate, keepAnswer, mateChoice } from '@firstmate/core/ask-mate';
import { sentenceOf } from './settings.ts';

/** One message of the panel's Conversation, as the panel shows it. */
export type Said = {
  readonly who: 'operator' | 'agent';
  readonly text: string;
  /** For an answer that ended early: whether it was stopped or failed. */
  readonly ended?: 'stopped' | 'failed';
  /** For an answer that failed: why, in one sentence. */
  readonly why?: string;
  /** Whether this answer still arrives. */
  readonly arriving?: boolean;
};

/** Everything the Mate panel shows of its Conversation. */
export type MateShown = {
  /** The Conversation's title, or nothing for a new one. */
  readonly title: string | undefined;
  /** The Agent's name, as a sentence says it. */
  readonly agent: string;
  /** Who answers, above each answer: the Agent's name, and its model when one was chosen. */
  readonly who: string;
  /** Who answers where, in one line: the Agent, the model, the effort and the Place. */
  readonly meta: string;
  /** The Place the Agent runs in, by name. */
  readonly place: string;
  /** Every message, the answer that arrives last. */
  readonly said: readonly Said[];
  /** Whether an answer arrives, so the panel takes no question. */
  readonly answering: boolean;
};

/** The Mate, as the window asks it for things. */
export type Mate = {
  /** What the panel shows now. */
  shown(): MateShown;
  /** Ask the Mate, in the shown Conversation. Refused while an answer arrives. */
  send(question: string): void;
  /** Stop the answer that arrives in the shown Conversation, keeping what arrived. */
  stop(): void;
  /** Show a new Conversation. An answer that still arrives in the last one goes on, and is kept. */
  fresh(): void;
  /** Stop every answer that still arrives, in every Conversation, as the App quits. */
  stopAll(): void;
  /** The text of one message of the shown Conversation, for the clipboard. */
  textOf(message: number): string | undefined;
};

/** What a Conversation started with, as its head names it. */
type Started = {
  readonly agent: keyof typeof AGENT_NAMES;
  readonly place: string;
  readonly model?: string;
  readonly effort?: string;
};

/** One Conversation, as the panel holds it. */
type Talk = {
  /** Its ID, once the Agent has started on its first question. */
  id?: string;
  title?: string;
  /** What it runs with, once it started. */
  started?: Started;
  readonly said: Said[];
  /** The answer that arrives, if one does. */
  answer?: Answer;
};

/** An answer that arrives: what arrived so far, and the run that writes it. */
type Answer = {
  text: string;
  /** The run, once the Agent has started. */
  run?: AgentRun;
  /** Whether the operator stopped it before the Agent had started. */
  stopped: boolean;
};

/**
 * Hold the Mate for this home. `changed` is called whenever what the panel
 * shows changed: a question sent, a part of an answer, an answer ended.
 */
export function holdMate(home: string, changed: () => void): Mate {
  let talk: Talk = { said: [] };
  /** Every answer that still arrives, the shown Conversation's and any other. */
  const arriving = new Set<Answer>();

  const send = (question: string): void => {
    const asked = question.trim();
    if (asked === '' || talk.answer !== undefined) return;
    const here = talk;
    const answer: Answer = { text: '', stopped: false };
    here.said.push({ who: 'operator', text: asked });
    here.answer = answer;
    arriving.add(answer);
    changed();
    void askMate(home, asked, here.id).then(
      (asking) => {
        here.id = asking.id;
        here.title = asking.head.title;
        here.started = asking.head;
        answer.run = asking.run;
        if (answer.stopped) asking.run.stop();
        changed();
        void hear(here, answer, asking.run);
      },
      // Refused before the Agent started: nothing was kept, and the panel
      // says why where the answer would be.
      (fault: unknown) =>
        end(here, { who: 'agent', text: '', ended: 'failed', why: sentenceOf(fault) }),
    );
  };

  /** Show each part of the answer as it arrives, and keep the answer once it ends. */
  const hear = async (here: Talk, answer: Answer, run: AgentRun): Promise<void> => {
    let last: Exclude<AgentEvent, { kind: 'text' }> | undefined;
    try {
      for await (const event of run.events) {
        if (event.kind === 'text') {
          answer.text += event.text;
          if (here === talk) changed();
        } else {
          last = event;
        }
      }
    } catch (fault) {
      last = { kind: 'failed', sentence: sentenceOf(fault) };
    }
    last ??= { kind: 'failed', sentence: 'The Agent ended with nothing to say about how.' };
    let kept: Said = {
      who: 'agent',
      text: answer.text,
      ...(last.kind === 'done' ? {} : { ended: last.kind }),
      ...(last.kind === 'failed' ? { why: last.sentence } : {}),
    };
    try {
      if (here.id !== undefined) keepAnswer(home, here.id, answer.text, last);
    } catch (fault) {
      kept = { ...kept, ended: 'failed', why: sentenceOf(fault) };
    }
    end(here, kept);
  };

  const end = (here: Talk, kept: Said): void => {
    if (here.answer !== undefined) arriving.delete(here.answer);
    here.said.push(kept);
    here.answer = undefined;
    if (here === talk) changed();
  };

  const stop = (answer: Answer | undefined): void => {
    if (answer === undefined) return;
    answer.stopped = true;
    answer.run?.stop();
  };

  return {
    shown: () => shownOf(home, talk),
    send,
    stop: () => stop(talk.answer),
    stopAll: () => {
      for (const answer of arriving) stop(answer);
    },
    fresh: () => {
      talk = { said: [] };
      changed();
    },
    textOf: (message) => talk.said[message]?.text,
  };
}

/**
 * What the panel shows of one Conversation. One that has not started yet
 * names what the Mate settings choose now, which it will start with; a
 * damaged setting is said there, and refuses the first question too.
 */
function shownOf(home: string, talk: Talk): MateShown {
  let started: Started;
  if (talk.started !== undefined) {
    started = talk.started;
  } else {
    try {
      const choice = mateChoice(home);
      started = { ...choice, place: choice.place.name };
    } catch (fault) {
      return {
        title: talk.title,
        agent: 'The Mate',
        who: 'The Mate',
        meta: sentenceOf(fault),
        place: '',
        said: saidOf(talk),
        answering: talk.answer !== undefined,
      };
    }
  }
  const agent = AGENT_NAMES[started.agent];
  const meta = [agent, started.model, started.effort, started.place].filter(
    (part) => part !== undefined && part !== '',
  );
  return {
    title: talk.title,
    agent,
    who: started.model === undefined ? agent : `${agent} · ${started.model}`,
    meta: meta.join(' · '),
    place: started.place,
    said: saidOf(talk),
    answering: talk.answer !== undefined,
  };
}

/** Every message of a Conversation, and the answer that arrives, last. */
function saidOf(talk: Talk): readonly Said[] {
  return talk.answer === undefined
    ? talk.said
    : [...talk.said, { who: 'agent', text: talk.answer.text, arriving: true }];
}
