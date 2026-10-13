/**
 * The Mate, as the App's main process holds it: the Mate panel, the
 * Conversation it shows, and the run of the Agent that answers it.
 *
 * It asks through `core`, as `firstmate ask` does, so the panel and the
 * terminal read the same Mate settings, hear an answer the same way, and keep
 * the same Conversations (ADR-0031). The panel's page only shows what this
 * holds and asks for what the operator did; it starts nothing itself. The
 * window only places the panel and passes it the panel's asks.
 *
 * One Conversation is shown at a time, and while its answer arrives it takes
 * no other question, so two answers never mix. A new Conversation, or an
 * older one opened from Recents, leaves an answer that still arrives to
 * finish and be kept with its own Conversation; opened again before it ends,
 * that Conversation shows the answer as it arrives. The panel's Conversation
 * is held for as long as the App runs, so the panel opens on it again after
 * it was closed and after a Plugin switch. Its width is kept in the Mate
 * settings once a drag of its edge ends, so it opens at that width after a
 * restart too (ADR-0012).
 *
 * Recents lists every Conversation in the home directory, those the terminal
 * made too. Delete removes FirstMate's file of a Conversation alone; the
 * Agent keeps its own session. A Conversation whose answer still arrives is
 * not deleted, because the answer would be kept in a file that is gone.
 */
import { clipboard } from 'electron';
import { AGENT_NAMES, type MateRun } from '@firstmate/core/agents';
import type { AgentRun } from '@firstmate/core/agent-run';
import { askMate, hear, mateChoice } from '@firstmate/core/ask-mate';
import { keepMateWidth } from '@firstmate/core/commands';
import {
  deleteConversation,
  listConversations,
  readWhole,
  type Listed,
  type Message,
} from '@firstmate/core/conversations';
import { sentenceOf } from '@firstmate/core/refusal';
import { readSettings } from '@firstmate/core/settings';
import type { Asked } from './ask.ts';
import { fitWidth, MATE_WIDTH, mateBounds, matePage } from './mate-view.ts';
import type { Written } from './pages.ts';

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

/** One Conversation, as Recents lists it. */
export type Recent = Listed & {
  /** Whether it is the Conversation the panel shows. */
  readonly open: boolean;
  /** Whether an answer still arrives in it, so it is not deleted. */
  readonly arriving: boolean;
};

/** The Mate panel's own asks, which the window hands it whole. */
const PANEL_ASKS = [
  'mate-close',
  'mate-new',
  'mate-recents',
  'mate-back',
  'mate-open',
  'mate-delete',
  'mate-expand',
  'mate-send',
  'mate-stop',
  'mate-copy',
  'mate-link',
  'mate-width',
  'mate-ask',
] as const;

/** One ask the Mate panel acts on. */
type PanelAsked = Extract<Asked, { readonly kind: (typeof PANEL_ASKS)[number] }>;

/** Whether an ask is one the Mate panel acts on. */
export function isPanelAsk(asked: Asked): asked is PanelAsked {
  return PANEL_ASKS.some((kind) => kind === asked.kind);
}

/** What the Mate panel needs of the window it is in. */
export type PanelNeeds = {
  readonly home: string;
  /** Send the panel's view this page. */
  show(page: Written): void;
  /** Draw the window again, with the panel as it is now. */
  redraw(): void;
  /** Lay the window's views out again, for a new width of the panel. */
  layout(): void;
  /**
   * The panel opened, closed, or took a new Conversation: draw the window
   * again, and give the focus to the panel when it is open, or back to what
   * is shown.
   */
  turned(open: boolean): void;
  /** Open a link of an answer in the operator's browser. */
  toBrowser(address: string): void;
};

/** The Mate panel, as the window places it and passes it its asks. */
export type MatePanel = {
  /** Whether the panel is open, at the right of the window. */
  isOpen(): boolean;
  /** Where the panel is in a window this wide, and what is left for the shown view. */
  bounds(width: number): ReturnType<typeof mateBounds>;
  /** Send the panel's page what it shows now, while it is open. */
  show(): void;
  /** Who answers a new Conversation, and where, in one line; or why no one can. */
  ahead(): string;
  /** Open the panel, or close it when it is open. */
  toggle(): void;
  /** Give the shown view back its side, when the panel has the whole width. */
  narrow(): void;
  /** Act on one of the panel's asks. */
  act(asked: PanelAsked): void;
  /** Stop every answer that still arrives, and keep the panel's width, as the App quits. */
  quit(): void;
};

/** How long the panel's width waits after the last drag before it is kept. */
const WIDTH_WAIT_MS = 500;

/** Recents, while the panel shows them, with what went wrong with the last thing asked of them. */
type RecentsHeld = { readonly rows: readonly Recent[]; readonly fault?: string };

/**
 * Hold the Mate panel for this window. It is closed at first, at the width
 * the Mate settings keep.
 */
export function holdMatePanel(needs: PanelNeeds): MatePanel {
  const { home } = needs;
  let open = false;
  /** Whether the open panel has the whole width below the strip. */
  let expanded = false;
  let width = keptWidth(home);
  /** The wait before a new width is kept, so that one drag writes the settings once. */
  let widthWait: NodeJS.Timeout | undefined;
  /** How many times the panel has opened or shown a new Conversation, so its page knows. */
  let opened = 0;
  /**
   * Recents, while the panel shows them: every Conversation as it was read
   * when Recents opened or last changed, so an answer that arrives does not
   * read every Conversation again for each of its parts.
   */
  let recents: RecentsHeld | undefined;

  const show = (): void => {
    if (!open) return;
    needs.show(
      matePage({
        shown: mate.shown(),
        opened,
        expanded,
        ...(recents === undefined ? {} : { recents: { ...recents, now: new Date() } }),
      }),
    );
  };
  /** The Mate, whose every change the panel shows: a question, a part of an answer, an end. */
  const mate = holdMate(home, show);

  /** Every Conversation, read now, with what went wrong with the last thing asked of Recents. */
  const readRecents = (fault?: string): RecentsHeld => {
    try {
      return { rows: mate.recents(), ...(fault === undefined ? {} : { fault }) };
    } catch (unread: unknown) {
      return { rows: [], fault: fault ?? sentenceOf(unread) };
    }
  };

  /** Keep the panel's width in the settings file now, if a new one waits. */
  const keepWidth = (): void => {
    if (widthWait === undefined) return;
    clearTimeout(widthWait);
    widthWait = undefined;
    try {
      keepMateWidth(home, width);
    } catch {
      // A settings file that cannot be read is said by the Settings View and
      // by every command; the width waits until it is mended.
    }
  };

  const toggle = (): void => {
    open = !open;
    // The panel opens again on its Conversation, never on Recents.
    recents = undefined;
    if (open) opened += 1;
    needs.turned(open);
  };

  const act = (asked: PanelAsked): void => {
    if (asked.kind === 'mate-close') {
      if (open) toggle();
    } else if (asked.kind === 'mate-new') {
      recents = undefined;
      mate.newConversation();
      opened += 1;
      show();
    } else if (asked.kind === 'mate-recents') {
      recents = readRecents();
      show();
    } else if (asked.kind === 'mate-back') {
      recents = undefined;
      show();
    } else if (asked.kind === 'mate-open') {
      // Opened, it shows in place of Recents; one that cannot be read stays
      // in Recents, which says why.
      recents = undefined;
      try {
        mate.open(asked.id);
        opened += 1;
      } catch (fault: unknown) {
        recents = readRecents(sentenceOf(fault));
      }
      show();
    } else if (asked.kind === 'mate-delete') {
      // FirstMate's file of the Conversation alone; the Agent keeps its own
      // session (ADR-0031).
      try {
        mate.deleteConversation(asked.id);
        recents = readRecents();
      } catch (fault: unknown) {
        recents = readRecents(sentenceOf(fault));
      }
      show();
    } else if (asked.kind === 'mate-expand') {
      expanded = !expanded;
      needs.redraw();
    } else if (asked.kind === 'mate-width') {
      width = fitWidth(asked.width);
      needs.layout();
      clearTimeout(widthWait);
      widthWait = setTimeout(keepWidth, WIDTH_WAIT_MS);
    } else if (asked.kind === 'mate-ask') {
      // The box starts a new Conversation in the panel, which opens on it.
      recents = undefined;
      mate.newConversation();
      mate.send(asked.text);
      opened += 1;
      if (open) needs.turned(true);
      else toggle();
    } else if (asked.kind === 'mate-send') {
      mate.send(asked.text);
    } else if (asked.kind === 'mate-stop') {
      mate.stop();
    } else if (asked.kind === 'mate-copy') {
      const text = mate.textOf(asked.message);
      if (text !== undefined) clipboard.writeText(text);
    } else {
      needs.toBrowser(asked.address);
    }
  };

  return {
    isOpen: () => open,
    bounds: (window) => mateBounds(window, { open, expanded, width }),
    show,
    ahead: () => mate.ahead(),
    toggle,
    narrow: () => {
      expanded = false;
    },
    act,
    quit: () => {
      // Every answer that still arrives ends with the App: no Agent runs on.
      mate.stopAll();
      keepWidth();
    },
  };
}

/**
 * The panel's width the settings file keeps, held to what the panel can be;
 * the first width when none is kept, or the settings cannot be read.
 */
function keptWidth(home: string): number {
  try {
    return fitWidth(readSettings(home).mate?.width ?? MATE_WIDTH);
  } catch {
    return MATE_WIDTH;
  }
}

/** The Mate's Conversations, as the panel asks them for things. */
type Mate = {
  /** What the panel shows now. */
  shown(): MateShown;
  /** Ask the Mate, in the shown Conversation. Refused while an answer arrives. */
  send(question: string): void;
  /** Stop the answer that arrives in the shown Conversation, keeping what arrived. */
  stop(): void;
  /** Show a new Conversation. An answer that still arrives in the last one goes on, and is kept. */
  newConversation(): void;
  /** Who answers a new Conversation, and where, in one line; or why no one can. */
  ahead(): string;
  /** Every Conversation in the home directory, the one said in last first. */
  recents(): readonly Recent[];
  /**
   * Show this Conversation, with all its messages, so the next message
   * resumes it. Throws, in one sentence, when it cannot be read.
   */
  open(id: string): void;
  /**
   * Delete this Conversation's file, and show a new one if it was shown.
   * Throws, in one sentence, while its answer still arrives.
   */
  deleteConversation(id: string): void;
  /** Stop every answer that still arrives, in every Conversation, as the App quits. */
  stopAll(): void;
  /** The text of one message of the shown Conversation, for the clipboard. */
  textOf(message: number): string | undefined;
};

/** What a Conversation started with, as its head names it. */
type Started = MateRun & { readonly place: string };

/** One Conversation, as the panel holds it. */
type Conversation = {
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
 * Hold the Mate's Conversations for this home. `changed` is called whenever
 * what the panel shows changed: a question sent, a part of an answer, an
 * answer ended.
 */
function holdMate(home: string, changed: () => void): Mate {
  let shown: Conversation = { said: [] };
  /** Every Conversation an answer still arrives in, the shown one and any other. */
  const live = new Set<Conversation>();

  const send = (question: string): void => {
    const asked = question.trim();
    if (asked === '' || shown.answer !== undefined) return;
    const here = shown;
    const answer: Answer = { text: '', stopped: false };
    here.said.push({ who: 'operator', text: asked });
    here.answer = answer;
    live.add(here);
    changed();
    void askMate(home, asked, here.id).then(
      (asking) => {
        here.id = asking.id;
        here.title = asking.head.title;
        here.started = asking.head;
        answer.run = asking.run;
        if (answer.stopped) asking.run.stop();
        changed();
        // Each part shows as it arrives; the answer is kept once it ends.
        void hear(home, asking, (part) => {
          answer.text += part;
          if (here === shown) changed();
        }).then(
          (end) =>
            finish(here, {
              who: 'agent',
              text: answer.text,
              ...(end.kind === 'done' ? {} : { ended: end.kind }),
              ...(end.kind === 'failed' ? { why: end.sentence } : {}),
            }),
          // The answer could not be kept: the panel says why under it.
          (fault: unknown) =>
            finish(here, {
              who: 'agent',
              text: answer.text,
              ended: 'failed',
              why: sentenceOf(fault),
            }),
        );
      },
      // Refused before the Agent started: nothing was kept, and the panel
      // says why where the answer would be.
      (fault: unknown) =>
        finish(here, { who: 'agent', text: '', ended: 'failed', why: sentenceOf(fault) }),
    );
  };

  const finish = (here: Conversation, kept: Said): void => {
    live.delete(here);
    here.said.push(kept);
    here.answer = undefined;
    if (here === shown) changed();
  };

  const stop = (answer: Answer | undefined): void => {
    if (answer === undefined) return;
    answer.stopped = true;
    answer.run?.stop();
  };

  /** The Conversation of this ID an answer still arrives in, if there is one. */
  const liveOf = (id: string): Conversation | undefined => [...live].find((one) => one.id === id);

  return {
    shown: () => shownOf(home, shown),
    send,
    stop: () => stop(shown.answer),
    stopAll: () => {
      for (const one of live) stop(one.answer);
    },
    newConversation: () => {
      shown = { said: [] };
      changed();
    },
    ahead: () => {
      try {
        const choice = mateChoice(home);
        return `${AGENT_NAMES[choice.agent]} · ${choice.place.name}`;
      } catch (fault) {
        return sentenceOf(fault);
      }
    },
    recents: () =>
      listConversations(home).map((listed) => ({
        ...listed,
        open: listed.id === shown.id,
        arriving: liveOf(listed.id) !== undefined,
      })),
    open: (id) => {
      shown = liveOf(id) ?? conversationOf(home, id);
      changed();
    },
    deleteConversation: (id) => {
      if (liveOf(id) !== undefined) {
        throw new Error('An answer still arrives in that Conversation. Stop it, then delete it.');
      }
      deleteConversation(home, id);
      if (shown.id === id) shown = { said: [] };
      changed();
    },
    textOf: (message) => shown.said[message]?.text,
  };
}

/** A Conversation kept in the home directory, as the panel holds it once it is opened. */
function conversationOf(home: string, id: string): Conversation {
  const { head, messages } = readWhole(home, id);
  return { id, title: head.title, started: head, said: messages.map(saidOfMessage) };
}

/** One kept message, as the panel shows it. */
function saidOfMessage(message: Message): Said {
  return {
    who: message.who,
    text: message.text,
    ...(message.ended === undefined ? {} : { ended: message.ended }),
    ...(message.why === undefined ? {} : { why: message.why }),
  };
}

/**
 * What the panel shows of one Conversation. One that has not started yet
 * names what the Mate settings choose now, which it will start with; a
 * damaged setting is said there, and refuses the first question too.
 */
function shownOf(home: string, conversation: Conversation): MateShown {
  let started: Started;
  if (conversation.started !== undefined) {
    started = conversation.started;
  } else {
    try {
      const choice = mateChoice(home);
      started = { ...choice, place: choice.place.name };
    } catch (fault) {
      return {
        title: conversation.title,
        agent: 'The Mate',
        who: 'The Mate',
        meta: sentenceOf(fault),
        place: '',
        said: saidOf(conversation),
        answering: conversation.answer !== undefined,
      };
    }
  }
  const agent = AGENT_NAMES[started.agent];
  const meta = [agent, started.model, started.effort, started.place].filter(
    (part) => part !== undefined && part !== '',
  );
  return {
    title: conversation.title,
    agent,
    who: started.model === undefined ? agent : `${agent} · ${started.model}`,
    meta: meta.join(' · '),
    place: started.place,
    said: saidOf(conversation),
    answering: conversation.answer !== undefined,
  };
}

/** Every message of a Conversation, and the answer that arrives, last. */
function saidOf(conversation: Conversation): readonly Said[] {
  return conversation.answer === undefined
    ? conversation.said
    : [...conversation.said, { who: 'agent', text: conversation.answer.text, arriving: true }];
}
