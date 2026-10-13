/**
 * The Mate box: "Ask the Mate", above the Plugin list.
 *
 * It is one of the App's own pages (`pages.ts`), in a view of its own that
 * the window puts between the strip and the Index Page's view while the
 * Index Page is shown, and it moves that view down by its height. The Index
 * Page itself does not change, and the Host never serves the box: every
 * Plugin Page shares the Index Page's origin, so a box the Host served would
 * let any Plugin ask the operator's Agent (ADR-0008, ADR-0031). The box
 * carries the App's preload, and the main process takes its one ask from it
 * alone.
 *
 * Enter opens the Mate panel with the question as the first message of a new
 * Conversation; Shift+Enter starts a new line. The page empties the field
 * itself once it has asked. The look is the board's "Hairline": one raised
 * field, as wide as the Plugin list at most, with the line that says who
 * answers a new Conversation, and where.
 */
import { type IconName, icon } from '@firstmate/core/theme';
import { TYPED } from './ask.ts';
import { escaped, written, type Written } from './pages.ts';

/** How tall the box is, in logical pixels: the Index Page's view sits this far lower. */
export const BOX_HEIGHT = 84;

/** The icons the box draws. */
const ICONS: readonly IconName[] = ['chat-circle-dots'];

/**
 * The box. `ahead` says who answers a new Conversation, and where, or why
 * no one can.
 */
export function boxPage(ahead: string): Written {
  return written(
    'Ask the Mate',
    boxStyles(),
    `<div class="box"><label class="field">${icon('chat-circle-dots', 'lead')}\
<textarea id="ask" data-key="ask" rows="1" placeholder="Ask the Mate" aria-label="Ask the Mate" \
spellcheck="true"></textarea>\
<span class="meta" title="${escaped(ahead)}">${escaped(ahead)}</span>\
<kbd aria-hidden="true">Enter</kbd></label></div>`,
    BOX_SCRIPT,
    ICONS,
  );
}

/** The box's own script: Enter asks, Shift+Enter starts a new line. */
const BOX_SCRIPT = `addEventListener('keydown', (event) => {
  const field = document.getElementById('ask');
  if (event.target !== field || event.key !== 'Enter') return;
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  const text = field.value.trim();
  if (text === '') return;
  firstmate.ask('${TYPED.mateAsk}/' + encodeURIComponent(text));
  field.value = '';
});`;

function boxStyles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--bg); }
  body { color: var(--text); font: 14px/1.5 var(--sans); }
  .box { height: 100vh; display: flex; align-items: center; padding: 0 16px; }
  .field {
    width: 100%; max-width: 640px; height: 44px; margin: 0 auto; display: flex;
    align-items: center; gap: 10px; padding: 0 8px 0 14px; cursor: text;
    background: var(--raised); border: 1px solid var(--line-2); border-radius: var(--radius-panel);
  }
  .field:focus-within { border-color: var(--faint); }
  .lead { color: var(--faint); }
  .field:focus-within .lead { color: var(--accent); }
  textarea {
    flex: 1; min-width: 0; height: 21px; resize: none; border: 0; outline: 0; padding: 0;
    background: none; color: var(--ink); font: inherit; line-height: 21px; overflow-y: auto;
    scrollbar-width: none;
  }
  textarea::placeholder { color: var(--faint); }
  .meta {
    flex: 0 1 auto; min-width: 0; max-width: 40%; font: 11px/1 var(--mono); color: var(--faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  kbd {
    flex: none; font: 11px/1 var(--mono); color: var(--faint); border: 1px solid var(--line-2);
    border-radius: 4px; padding: 3px 5px;
  }`;
}
