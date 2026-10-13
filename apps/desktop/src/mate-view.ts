/**
 * The Mate panel: the header, the Conversation, and the field the operator
 * asks in, at the right of the window.
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can type into it or read it (ADR-0031). It carries the App's
 * preload, and the main process takes a Mate ask from this view alone.
 *
 * The look is the one chosen on the board of #218, "Hairline": the page's own
 * ground with one line at its edge, the operator's messages in quiet raised
 * bubbles, and answers as plain text at full width. An answer is shown in a
 * small part of Markdown (`markdown.ts`), which escapes everything it does
 * not draw.
 *
 * Enter sends and Shift+Enter starts a new line. While an answer arrives the
 * send button is Stop, and the field takes no question. What is typed lives in
 * the page: a body never empties the field, and the page empties it itself
 * once it has sent it. The Conversation stays scrolled to its end while the
 * answer arrives, unless the operator scrolled up to read.
 *
 * The panel's left edge is a 6 px handle that sets its width. The page asks
 * for a width from where the drag started, in screen pixels, so it does not
 * matter that the view moves under the pointer as it narrows the page.
 */
import { type IconName, icon } from '@firstmate/core/theme';
import { ASK, mateCopyAsk, TYPED } from './ask.ts';
import { markdown } from './markdown.ts';
import type { MateShown, Said } from './mate.ts';
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
export type MatePanel = {
  readonly shown: MateShown;
  /** How many times the panel has opened, so its page knows a new opening. */
  readonly opened: number;
  /** Whether it has the whole width below the strip. */
  readonly expanded: boolean;
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
];

/** The Mate panel. */
export function matePage(panel: MatePanel): Written {
  const { shown, opened, expanded } = panel;
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
  const failed =
    said.ended === 'failed'
      ? `<div class="err" role="alert">${icon('warning-circle')}\
<p>${escaped(said.why ?? '')}</p></div>`
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
  typed.style.height = 'auto';
  typed.style.height = Math.min(typed.scrollHeight, 168) + 'px';
};
const ready = () => {
  const send = document.getElementById('send');
  if (send !== null) send.classList.toggle('off', field().value.trim() === '');
};
const send = () => {
  if (panel().dataset.answering !== undefined) return;
  const text = field().value.trim();
  if (text === '') return;
  firstmate.ask('${TYPED.mateSend}/' + encodeURIComponent(text));
  field().value = '';
  following = true;
  grow();
  ready();
};
whenShown(() => {
  if (panel() === null) return;
  if (panel().dataset.opened !== opened) {
    opened = panel().dataset.opened;
    following = true;
    field().focus();
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
  if (event.target !== field() || event.key !== 'Enter') return;
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
});
addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('#send') !== null) { event.preventDefault(); send(); return; }
  const copy = event.target.closest('.copy');
  if (copy !== null) {
    copy.classList.add('done');
    setTimeout(() => copy.classList.remove('done'), 1200);
  }
});
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
  .send.stop { background: var(--ink); color: var(--bg); }`;
}
