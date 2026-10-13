/**
 * The Mate panel: the header, the Conversation, and the field the operator
 * asks in, at the right of the window.
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can type into it or read it (ADR-0031). It carries the App's
 * preload, and the main process takes a Mate ask from this view alone.
 *
 * The panel stays quiet, so that the answer is what the eye reads: the page's
 * own ground with one line at its edge, where it meets the shown page, the
 * operator's messages in quiet raised bubbles, and answers as plain text at
 * full width, as long text reads best. An answer is shown in a small part of
 * Markdown (`markdown.ts`), which escapes everything it does not draw.
 *
 * Enter sends and Shift+Enter starts a new line. While an answer arrives the
 * send button is Stop, and the field takes no question. What is typed lives in
 * the page: a body never empties the field, and the page empties it itself
 * once it has sent it. The Conversation stays scrolled to its end while the
 * answer arrives, unless the operator scrolled up to read.
 *
 * Recents shows in the panel in place of the Conversation: every
 * Conversation by title, with its Agent and model, in four groups counted in
 * calendar days, the one said in last first. Back returns to the
 * Conversation, as Esc does. Delete asks once more, in the row itself, before
 * it deletes, because a deleted Conversation does not come back.
 *
 * The panel's left edge is a 6 px handle that sets its width. The page asks
 * for a width from where the drag started, in screen pixels, so it does not
 * matter that the view moves under the pointer as it narrows the page.
 */
import { saysCannotResume } from '@firstmate/core/agents';
import { type IconName, icon } from '@firstmate/core/theme';
import { ASK, mateCopyAsk, mateDeleteAsk, mateOpenAsk, TYPED } from './ask.ts';
import { markdown } from './markdown.ts';
import type { MateShown, Recent, Said } from './mate.ts';
import { escaped, written, type Written } from './pages.ts';

/** How wide the panel is at first, in logical pixels. */
export const MATE_WIDTH = 380;

/** The narrowest the panel is, and the narrowest it leaves the page beside it. */
const PANEL_LEAST = 300;
const PAGE_LEAST = 320;

/** The panel's place in the window, and what is left for the shown view. */
type MateBounds = {
  /** The shown view's width, from the window's left edge; 0 when it is hidden. */
  readonly page: number;
  /** The panel's width, up to the window's right edge; 0 when it is closed. */
  readonly panel: number;
};

/**
 * Where the panel is in a window this wide: nowhere when closed, the whole
 * width when expanded, and otherwise at the right, as wide as the operator
 * left it, but never so wide that the page beside it is narrower than it can
 * be read, nor narrower than its own header.
 */
export function mateBounds(
  width: number,
  panel: { readonly open: boolean; readonly expanded: boolean; readonly width: number },
): MateBounds {
  if (!panel.open) return { page: width, panel: 0 };
  if (panel.expanded) return { page: 0, panel: width };
  const wide = Math.min(fitWidth(panel.width), Math.max(width - PAGE_LEAST, PANEL_LEAST));
  const shown = Math.min(wide, width);
  return { page: width - shown, panel: shown };
}

/** A width the operator asked for, held between the narrowest and a sensible widest. */
export function fitWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), PANEL_LEAST), 1600);
}

/** The panel, as the window holds it. */
export type PanelPage = {
  readonly shown: MateShown;
  /** How many times the panel has opened, so its page knows a new opening. */
  readonly opened: number;
  /** Whether it has the whole width below the strip. */
  readonly expanded: boolean;
  /** Recents, when the panel shows them in place of its Conversation. */
  readonly recents?: RecentsShown;
};

/** Recents, as the panel shows them. */
type RecentsShown = {
  /** Every Conversation, the one said in last first, as they were read when Recents opened. */
  readonly rows: readonly Recent[];
  /** Now, which the groups are counted from. */
  readonly now: Date;
  /** What went wrong with the last thing asked of Recents, until the next one. */
  readonly fault?: string;
};

/** The icons any body of the panel may draw. */
const ICONS: readonly IconName[] = [
  'note-pencil',
  'arrows-out-simple',
  'arrows-in-simple',
  'gear-six',
  'x',
  'arrow-up',
  'stop-fill',
  'copy',
  'check',
  'warning-circle',
  'arrow-square-out',
  'clock-counter-clockwise',
  'arrow-left',
  'trash',
];

/** The Mate panel. */
export function matePage(panel: PanelPage): Written {
  const { shown, opened, expanded, recents } = panel;
  if (recents !== undefined) return recentsPage(recents, opened, expanded);
  const title = shown.title === undefined ? 'New Conversation' : escaped(shown.title);
  const conversation =
    shown.said.length === 0
      ? `<div class="empty" data-key="empty"><h4>Where should we begin?</h4>
<p>${escaped(shown.agent)} answers${shown.place === '' ? '' : ` from ${escaped(shown.place)}`}. \
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> opens and closes this panel.</p></div>`
      : `<div class="msgs" id="msgs" data-key="msgs" role="log" aria-live="polite">
${shown.said.map((said, at) => message(said, at, shown.who)).join('\n')}
</div>`;
  const send = shown.answering
    ? `<button class="send stop" type="button" data-key="stop" data-ask="${ASK.mateStop}" \
title="Stop" aria-label="Stop">${icon('stop-fill')}</button>`
    : `<button class="send" type="button" data-key="send" id="send" title="Send (Enter)" \
aria-label="Send">${icon('arrow-up')}</button>`;
  const placeholder = shown.answering ? 'Wait for the answer, or stop it' : 'Ask the Mate';
  return written(
    'Mate',
    mateStyles(),
    `<div class="panel${expanded ? ' wide' : ''}" data-opened="${opened}"\
${shown.answering ? ' data-answering' : ''}>
${expanded ? '' : '<span class="resize" data-key="resize" aria-hidden="true"></span>'}
<header class="phd">
<span class="ttl" title="${title}">${title}</span>
${button(ASK.mateRecents, 'clock-counter-clockwise', 'Recents')}
${button(ASK.mateNew, 'note-pencil', 'New Conversation')}
${button(
  ASK.mateExpand,
  expanded ? 'arrows-in-simple' : 'arrows-out-simple',
  expanded ? 'Give the page its width back' : 'Expand',
)}
${button(ASK.mateSettings, 'gear-six', 'Mate settings')}
${button(ASK.mateClose, 'x', 'Close (Ctrl+Shift+K)')}
</header>
${conversation}
<div class="comp"><div class="field">
<textarea id="ask" data-key="ask" rows="1" placeholder="${placeholder}" aria-label="Ask the Mate" \
spellcheck="true"></textarea>
<div class="crow"><span class="meta" title="${escaped(shown.meta)}">\
${escaped(shown.meta)}</span>${send}</div>
</div></div>
</div>`,
    MATE_SCRIPT,
    ICONS,
  );
}

/**
 * Recents in place of the Conversation: Back, New Conversation and Close in
 * the header, and every Conversation by title below, in four groups. A row
 * opens its Conversation. Its Delete asks once more before it deletes, as the
 * page's script says, because a deleted Conversation does not come back.
 */
function recentsPage(recents: RecentsShown, opened: number, expanded: boolean): Written {
  const { rows, now, fault } = recents;
  const said =
    fault === undefined
      ? ''
      : `<div class="err" role="alert" data-key="fault">${icon('warning-circle')}\
<p>${escaped(fault)}</p></div>`;
  const list =
    rows.length === 0
      ? `<p class="none" data-key="none">No Conversation yet. Ask the Mate here, or run \
<code>firstmate ask</code> in a terminal.</p>`
      : GROUPS.map((group) => {
          const inGroup = rows.filter((row) => groupOf(row.when, now) === group);
          if (inGroup.length === 0) return '';
          return `<div class="grp" data-key="g${group}">${group}</div>
${inGroup.map(recentRow).join('\n')}`;
        }).join('\n');
  return written(
    'Mate',
    mateStyles(),
    `<div class="panel${expanded ? ' wide' : ''}" data-opened="${opened}">
${expanded ? '' : '<span class="resize" data-key="resize" aria-hidden="true"></span>'}
<header class="phd">
${button(ASK.mateBack, 'arrow-left', 'Back to the Conversation')}
<span class="ttl rttl">Recents</span>
${button(ASK.mateNew, 'note-pencil', 'New Conversation')}
${button(ASK.mateClose, 'x', 'Close (Ctrl+Shift+K)')}
</header>
<div class="rec" id="rec" data-key="rec">
${said}
${list}
</div>
</div>`,
    MATE_SCRIPT,
    ICONS,
  );
}

/** The groups of Recents, in the order they are shown. */
const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;

/** How long a day is, in milliseconds. */
const DAY = 86_400_000;

/**
 * The group of a Conversation said in last at `when`, counted in calendar
 * days of the operator's own clock: today, the day before, the seven days
 * before that, or older. A time in the future is today's.
 */
function groupOf(when: string, now: Date): (typeof GROUPS)[number] {
  const dayOf = (time: Date): number =>
    new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  // Rounded, so a day of 23 or 25 hours, when the clock moves, is one day.
  const days = Math.round((dayOf(now) - dayOf(new Date(when))) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  return 'Older';
}

/**
 * One row of Recents: the title, which opens it, and its Agent and model; or,
 * for a Conversation that cannot be read, the sentence that says why. Each has
 * Delete, but one whose answer still arrives.
 */
function recentRow(row: Recent): string {
  const remove = row.arriving
    ? ''
    : `<button class="del" type="button" data-delete="${escaped(mateDeleteAsk(row.id))}" \
title="Delete this Conversation" aria-label="Delete this Conversation">${icon('trash')}\
<span class="sure">Delete</span></button>`;
  if (row.kind === 'unreadable') {
    return `<div class="rrow bad" data-key="r${row.id}">${icon('warning-circle')}\
<span class="why">${escaped(row.why)}</span>${remove}</div>`;
  }
  const who = row.model === undefined ? row.agent : `${row.agent} · ${row.model}`;
  return `<div class="rrow${row.open ? ' now' : ''}" data-key="r${row.id}">\
<button class="t" type="button" data-ask="${escaped(mateOpenAsk(row.id))}" \
title="${escaped(row.title)}"${row.open ? ' aria-current="true"' : ''}>${escaped(row.title)}</button>\
<span class="ag">${escaped(who)}</span>${remove}</div>`;
}

/** One button of the header, with the words it says only to a reader and in its title. */
function button(ask: string, glyph: IconName, words: string): string {
  return `<button class="tb" type="button" data-ask="${ask}" title="${words}" \
aria-label="${words}">${icon(glyph)}</button>`;
}

/**
 * One message. The operator's is shown as it was typed; an answer is
 * Markdown, with a caret while it arrives, what ended it when it ended early,
 * and a button that copies it once it is there.
 */
function message(said: Said, at: number, who: string): string {
  if (said.who === 'operator') {
    return `<div class="msg op" data-key="m${at}"><div class="txt">\
${escaped(said.text)}</div></div>`;
  }
  const caret = said.arriving === true ? '<span class="cur" aria-hidden="true"></span>' : '';
  // The caret ends the last paragraph, so it sits where the next word will.
  const drawn = markdown(said.text);
  const ended = drawn.endsWith('</p>') ? `${drawn.slice(0, -4)}${caret}</p>` : `${drawn}${caret}`;
  const text = said.text === '' && caret === '' ? '' : `<div class="txt md">${ended}</div>`;
  // A session the Agent no longer holds is never resumed, so the way on is
  // a new Conversation, offered where the failure is said.
  const anew = saysCannotResume(said.why ?? '')
    ? `<button class="again" type="button" data-ask="${ASK.mateNew}">\
${icon('note-pencil')}New Conversation</button>`
    : '';
  const failed =
    said.ended === 'failed'
      ? `<div class="err" role="alert">${icon('warning-circle')}\
<div><p>${escaped(said.why ?? '')}</p>${anew}</div></div>`
      : '';
  const stopped = said.ended === 'stopped' ? '<span class="ended">Stopped</span>' : '';
  const copy =
    said.arriving === true || said.text === ''
      ? ''
      : `<button class="copy" type="button" data-ask="${escaped(mateCopyAsk(at))}" \
title="Copy the answer" aria-label="Copy the answer">\
${icon('copy', 'is')}${icon('check', 'did')}</button>`;
  const acts = copy === '' && stopped === '' ? '' : `<div class="acts">${copy}${stopped}</div>`;
  return `<div class="msg ag" data-key="m${at}"><div class="who">${escaped(who)}</div>\
${text}${failed}${acts}</div>`;
}

/**
 * The panel's own script: the field, the keys, the scroll that follows the
 * answer, the copy button's tick, and the edge that sets the width.
 */
const MATE_SCRIPT = `const field = () => document.getElementById('ask');
const panel = () => document.querySelector('.panel');
let opened;
let following = true;
const grow = () => {
  const typed = field();
  if (typed === null) return;
  typed.style.height = 'auto';
  typed.style.height = Math.min(typed.scrollHeight, 168) + 'px';
};
const ready = () => {
  const send = document.getElementById('send');
  if (send !== null && field() !== null) send.classList.toggle('off', field().value.trim() === '');
};
const send = () => {
  if (panel().dataset.answering !== undefined || field() === null) return;
  const text = field().value.trim();
  if (text === '') return;
  firstmate.ask('${TYPED.mateSend}/' + encodeURIComponent(text));
  field().value = '';
  following = true;
  grow();
  ready();
};
const disarm = () => {
  for (const row of document.querySelectorAll('.rrow.arm')) row.classList.remove('arm');
};
whenShown(() => {
  if (panel() === null) return;
  const shown = panel().dataset.opened + (field() === null ? 'r' : 'c');
  if (shown !== opened) {
    opened = shown;
    following = true;
    disarm();
    if (field() !== null) field().focus();
    else (document.querySelector('.rrow .t') ?? document.querySelector('.phd .tb'))?.focus();
  }
  const msgs = document.getElementById('msgs');
  if (msgs !== null && following) msgs.scrollTop = msgs.scrollHeight;
  grow();
  ready();
});
addEventListener('scroll', (event) => {
  const msgs = document.getElementById('msgs');
  if (event.target !== msgs) return;
  following = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 24;
}, true);
addEventListener('input', () => { grow(); ready(); });
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.getElementById('rec') !== null) {
    if (document.querySelector('.rrow.arm') !== null) disarm();
    else firstmate.ask('${ASK.mateBack}');
    return;
  }
  if (event.target !== field() || event.key !== 'Enter') return;
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
});
addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('#send') !== null) { event.preventDefault(); send(); return; }
  // Delete asks once more: the first click shows the word, the second deletes.
  const remove = event.target.closest('.del');
  if (remove !== null) {
    const row = remove.closest('.rrow');
    if (row.classList.contains('arm')) firstmate.ask(remove.dataset.delete);
    else { disarm(); row.classList.add('arm'); }
    return;
  }
  disarm();
  const copy = event.target.closest('.copy');
  if (copy !== null) {
    copy.classList.add('done');
    setTimeout(() => copy.classList.remove('done'), 1200);
  }
});
addEventListener('pointerleave', (event) => {
  if (event.target instanceof Element && event.target.matches('.rrow.arm')) disarm();
}, true);
addEventListener('pointerdown', (event) => {
  if (!(event.target instanceof Element) || event.target.closest('.resize') === null) return;
  event.preventDefault();
  const edge = event.target.closest('.resize');
  edge.setPointerCapture(event.pointerId);
  const from = event.screenX;
  const width = innerWidth;
  let asked = 0;
  const move = (moved) => {
    const wanted = Math.max(Math.round(width + from - moved.screenX), 0);
    if (wanted === asked) return;
    asked = wanted;
    firstmate.ask('${TYPED.mateWidth}/' + wanted);
  };
  const done = () => {
    edge.removeEventListener('pointermove', move);
    edge.removeEventListener('pointerup', done);
    edge.removeEventListener('pointercancel', done);
    document.body.classList.remove('sizing');
  };
  document.body.classList.add('sizing');
  edge.addEventListener('pointermove', move);
  edge.addEventListener('pointerup', done);
  edge.addEventListener('pointercancel', done);
});`;

function mateStyles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--bg); }
  body { color: var(--text); font: 13px/1.5 var(--sans); }
  body.sizing, body.sizing * { cursor: col-resize !important; user-select: none; }
  button {
    font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer;
  }
  button:focus-visible, textarea:focus-visible, a:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .panel {
    position: relative; height: 100vh; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--line); background: var(--bg);
  }
  .panel.wide { border-left: 0; }
  .resize {
    position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 1;
  }
  .resize:hover { background: linear-gradient(to right, var(--accent-soft), transparent); }
  .phd {
    height: 44px; flex: none; display: flex; align-items: center; gap: 2px; padding: 0 6px 0 14px;
    user-select: none;
  }
  .ttl {
    flex: 1; min-width: 0; font-weight: 600; color: var(--ink); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .tb {
    width: 28px; height: 28px; flex: none; display: grid; place-items: center;
    border-radius: var(--radius-control); color: var(--muted);
  }
  .tb:hover { background: var(--hover); color: var(--ink); }
  .tb:active { background: var(--press); }
  .msgs {
    flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px 12px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .wide .msgs, .wide .comp { padding-inline: max(16px, calc(50% - 340px)); }
  .msg { min-width: 0; }
  .msg .who { font-size: 11.5px; color: var(--faint); margin-bottom: 4px; }
  .msg.op { align-self: flex-end; max-width: 86%; }
  .msg.op .txt {
    color: var(--ink); background: var(--raised); border: 1px solid var(--line);
    border-radius: var(--radius-panel); padding: 8px 11px; white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .md { overflow-wrap: anywhere; user-select: text; }
  .md p { margin: 0 0 8px; }
  .md > :last-child { margin-bottom: 0; }
  .md h3 { margin: 4px 0 6px; font-size: 14px; color: var(--ink); }
  .md h4 { margin: 4px 0 6px; font-size: 13px; color: var(--ink); }
  .md ol, .md ul { margin: 0 0 8px; padding-left: 20px; }
  .md li { margin: 2px 0; }
  .md li > p, .md li > ul, .md li > ol { margin: 2px 0; }
  .md blockquote {
    margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--line-2);
    color: var(--muted);
  }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
  .md strong { color: var(--ink); font-weight: 600; }
  .md code {
    font: 12px/1 var(--mono); color: var(--ink); background: var(--raised);
    border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px;
  }
  .md pre {
    margin: 0 0 8px; padding: 10px 12px; background: var(--chrome); border: 1px solid var(--line);
    border-radius: var(--radius-panel); font: 12px/1.55 var(--mono); color: var(--ink);
    white-space: pre; overflow-x: auto;
  }
  .md pre code { font: inherit; background: none; border: 0; padding: 0; }
  .md a {
    color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
  }
  .md a svg.i {
    display: inline-block; width: 12px; height: 12px; vertical-align: -1px; margin-left: 2px;
  }
  .cur {
    display: inline-block; width: 7px; height: 14px; background: var(--accent);
    vertical-align: -2px;
    margin-left: 1px; border-radius: 1px; animation: blink 1s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .cur { animation: none; } }
  .acts { display: flex; align-items: center; gap: 8px; margin-top: 6px; min-height: 24px; }
  .copy {
    width: 24px; height: 24px; display: grid; place-items: center; color: var(--faint);
    border-radius: var(--radius-control);
  }
  .copy:hover { background: var(--hover); color: var(--ink); }
  .copy svg.i { width: 14px; height: 14px; }
  .copy .did, .copy.done .is { display: none; }
  .copy.done .did { display: block; color: var(--running); }
  .ended { font-size: 11.5px; color: var(--faint); }
  .err {
    display: flex; gap: 10px; margin-top: 6px; padding: 10px 12px;
    border-radius: var(--radius-panel); background: var(--stopped-soft); color: var(--ink);
  }
  .err > svg.i { color: var(--stopped); margin-top: 2px; }
  .err p { margin: 0; overflow-wrap: anywhere; user-select: text; }
  .again {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; margin-top: 8px;
    padding: 0 9px; border-radius: var(--radius-control); border: 1px solid var(--line-2);
    background: var(--bg); color: var(--text); font: 12px/1 var(--sans); cursor: pointer;
  }
  .again svg.i { width: 13px; height: 13px; }
  .again:hover { border-color: var(--faint); color: var(--ink); }
  .again:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 6px; padding: 0 24px; user-select: none;
  }
  .empty h4 {
    margin: 0; font-size: 18px; font-weight: 600; color: var(--ink); letter-spacing: -.01em;
  }
  .empty p { margin: 0; color: var(--faint); font-size: 12.5px; max-width: 32ch; }
  kbd {
    font: 11px/1 var(--mono); color: var(--faint); border: 1px solid var(--line-2);
    border-radius: 4px; padding: 2px 4px;
  }
  .comp { flex: none; padding: 4px 12px 12px; }
  .field {
    min-height: 66px; padding: 10px 12px 8px; border-radius: var(--radius-panel);
    display: flex; flex-direction: column; gap: 8px;
    background: var(--raised); border: 1px solid var(--line-2);
  }
  .field:focus-within { border-color: var(--faint); }
  .field textarea {
    flex: 1; resize: none; border: 0; outline: 0; padding: 0; background: none;
    color: var(--ink); font: 13px/1.5 var(--sans); min-height: 20px; max-height: 168px;
  }
  .field textarea::placeholder { color: var(--faint); }
  .crow { display: flex; align-items: center; gap: 8px; }
  .meta {
    flex: 1; min-width: 0; font: 11px/1 var(--mono); color: var(--faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .send {
    width: 28px; height: 28px; flex: none; border-radius: var(--radius-control);
    display: grid; place-items: center; background: var(--accent); color: var(--accent-ink);
  }
  .send.off { background: var(--hover); color: var(--faint); cursor: default; }
  .send.stop { background: var(--ink); color: var(--bg); }
  .rec { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; }
  .rec > .err { margin: 4px 8px 8px; }
  .wide .rec { padding-inline: max(8px, calc(50% - 348px)); }
  .grp {
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--faint); padding: 12px 8px 4px; user-select: none;
  }
  .rrow {
    display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 4px 0 8px;
    border-radius: var(--radius-control);
  }
  .rrow:hover { background: var(--hover); }
  .rrow.now { background: var(--accent-soft); color: var(--ink); }
  .rrow .t {
    flex: 1; min-width: 0; align-self: stretch; text-align: left; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .rrow .ag { flex: none; font: 11px/1 var(--mono); color: var(--faint); padding-right: 4px; }
  .rrow .del {
    flex: none; height: 26px; min-width: 26px; padding: 0 5px; display: none;
    align-items: center; gap: 4px; border-radius: var(--radius-control); color: var(--muted);
  }
  .rrow .del:hover { background: var(--press); color: var(--ink); }
  .rrow:hover .del, .rrow:focus-within .del, .rrow.arm .del { display: inline-flex; }
  .rrow:hover .ag, .rrow:focus-within .ag, .rrow.arm .ag { display: none; }
  .rrow .sure { display: none; font-size: 12px; }
  .rrow.arm .del { color: var(--stopped); }
  .rrow.arm .sure { display: inline; }
  .rrow.bad { color: var(--muted); padding-block: 6px; }
  .rrow.bad > svg.i { color: var(--stopped); }
  .rrow.bad .why { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
  .rrow.bad .del { display: inline-flex; }
  .none { margin: 24px 16px; color: var(--faint); font-size: 12.5px; text-align: center; }
  .none code { font: 11.5px/1 var(--mono); color: var(--muted); }`;
}
