/**
 * The App's own pages: the strip and the switcher, and what every one of the
 * App's pages shares. The Settings View is `settings-view.ts`.
 *
 * The strip is the window's title bar. It says where the window is as a
 * breadcrumb, the anchor and FirstMate and then what is open, and each part
 * goes somewhere: FirstMate to the Index Page, what is open to the switcher,
 * which lists every Plugin in the Plugin Order. The space between them and
 * the gear is where the window is dragged from. When any Plugin is Stopped, a
 * pill says how many, and it opens the switcher too. The gear opens the
 * Settings View. The window's own buttons are the system's, drawn beside it.
 *
 * The switcher has a filter at its top, the rows below it, and a line that
 * says its keys. Typing narrows the rows, the arrows move, Enter opens and
 * Esc closes. A Stopped row has a Restart button, which asks the main
 * process to start its Plugin Server again: the Host never does that on its
 * own account. Opened from the keyboard it shows at once; from the pointer it
 * fades in.
 *
 * Each page is one file with no assets of its own, written here and loaded as
 * a data address. The Host never serves one, and must never serve one: every
 * Plugin Page shares an origin with the Index Page, so a strip the Host served
 * would be a strip a Plugin Page could read and rewrite (ADR-0008). A page asks
 * the main process for something through `firstmate.ask`, which only these
 * pages carry (`preload.ts`).
 *
 * Each view loads its page once. After that, when what a page shows changes,
 * the main process sends the page its new body over IPC (`SHOW_CHANNEL`), and
 * the page's own script puts it in place: it keeps every element that is
 * still there and changes only what differs, so the operator's focus, scroll
 * and typed text survive. A row that can move carries `data-key`, so it is
 * matched by what it is rather than where it was. A page that sets something
 * on itself, such as which field is hidden, does it again in `whenShown`,
 * which runs once at load and after every body.
 *
 * Every page takes its colours, radii, state shapes and icons from
 * `@firstmate/core/theme`, the look the Index Page takes too, and carries the
 * sprite of the icons it draws inside itself.
 */
import { STATE_WORDS } from '@firstmate/core/plugin-state';
import { type IconName, icon, sprite, THEME_STYLE } from '@firstmate/core/theme';
import { ASK, openAsk, restartAsk } from './ask.ts';
import type { PluginSeen, Plugins } from './host-lists.ts';

/**
 * One of the App's own pages: the whole page, which a view loads once, and the
 * body it shows now, which is all the main process sends after that.
 */
export type Written = {
  /** The whole page, around this body. */
  readonly whole: (body: string) => string;
  /** What the page shows now. */
  readonly body: string;
};

/** Where the window is: the Index Page, one Plugin Page, or the Settings View. */
export type Here =
  | { readonly kind: 'list' }
  | { readonly kind: 'plugin'; readonly name: string }
  | { readonly kind: 'settings' };

/** Everything the strip says. */
export type StripView = {
  readonly here: Here;
  /** Whether the switcher is open. */
  readonly switcher: boolean;
  /** What went wrong with the last thing asked for, until the next one. */
  readonly fault: string | undefined;
  /** Whether the Host is still starting, so there is no Plugin to list or open yet. */
  readonly starting: boolean;
  /** How many Plugins are Stopped. */
  readonly stopped: number;
};

/** How tall the strip is, in logical pixels. It is the title bar, so the
 *  window's own buttons are this tall too. */
export const STRIP_HEIGHT = 40;

/** How wide the switcher is, in logical pixels. */
export const SWITCHER_WIDTH = 360;

/** How far the switcher sits from the window's left edge, under the breadcrumb. */
export const SWITCHER_LEFT = 8;

/** Everything the switcher shows. */
export type SwitcherView = {
  /** The Plugin whose page is open, if one is. */
  readonly open: string | undefined;
  readonly plugins: Plugins;
  /** How many times the switcher has opened, so its page knows a new opening. */
  readonly opened: number;
  /** Whether it opened from the keyboard, so it shows with no fade. */
  readonly instant: boolean;
  /** The Plugins whose restart was asked for and has not answered yet. */
  readonly restarting: readonly string[];
};

/** How tall one row of the switcher is, the filter above the rows, the key
 *  line below them, and the space around the rows, in logical pixels. The
 *  switcher's style gives each part exactly this height. */
const ROW = 34;
const FILTER = 39;
const KEYS = 36;
const AROUND = 10;

/** How long the switcher fades in for, when the pointer opened it. */
const FADE_MS = 120;

/**
 * What a page may do. It runs its own inline script and style and nothing
 * else: it loads nothing, connects nowhere and is framed by nothing.
 */
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'";

/** How tall the switcher needs to be to show the filter, every row and the
 *  key line. The window holds it inside its own height, and the rows scroll
 *  past that. A filter leaves the height as it is. */
export function switcherHeight(plugins: Plugins): number {
  const rows = plugins.kind === 'told' ? Math.max(plugins.plugins.length, 1) : 1;
  return FILTER + rows * ROW + AROUND + KEYS;
}

/** A page, as the address a view loads it from. */
export function dataAddress(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** The strip. */
export function stripPage(view: StripView): Written {
  const atTheList = view.here.kind === 'list';
  const switcher = view.switcher ? ASK.switcherClose : ASK.switcher;
  // Opened from the keyboard, the switcher shows at once.
  const keys = view.switcher ? '' : ` data-keys="${ASK.switcherKeys}"`;
  const crumbs = `<a class="crumb" href="#" data-ask="${ASK.pluginList}"\
${atTheList ? ' aria-disabled="true"' : ''} title="See the Plugin list">\
${icon('anchor', 'mark')}<span class="lbl">FirstMate</span></a>
${icon('caret-right', 'sep')}
<a class="crumb here" href="#" data-ask="${switcher}"${keys} aria-haspopup="menu" \
aria-expanded="${view.switcher}"${view.starting ? ' aria-disabled="true"' : ''} \
title="Switch Plugin">${hereWords(view.here, view.starting)}${icon('caret-down', 'caret')}</a>`;
  const fault =
    view.fault === undefined
      ? ''
      : `<span class="fault" role="status">${icon('warning-circle')}\
<span>${escaped(view.fault)}</span></span>`;
  const pill =
    view.stopped === 0
      ? ''
      : `<a class="pill" href="#" data-ask="${switcher}"${keys} title="See which Plugins are Stopped">\
<span class="dot stopped" aria-hidden="true"></span>${view.stopped}<span class="w"> Stopped</span></a>`;
  return written(
    'FirstMate',
    stripStyles(),
    `<nav class="bar">
${crumbs}
${fault}
<span class="drag"></span>
${pill}
<a class="gear" href="#" data-ask="${ASK.settings}" title="Settings" aria-label="Settings" \
aria-pressed="${view.here.kind === 'settings'}">${icon('gear-six')}</a>
</nav>`,
    '',
    STRIP_ICONS,
  );
}

/** The icons the strip draws. */
const STRIP_ICONS: readonly IconName[] = [
  'anchor',
  'caret-right',
  'caret-down',
  'warning-circle',
  'gear-six',
];

/** The last part of the breadcrumb: what is open, or that the Host still starts. */
function hereWords(here: Here, starting: boolean): string {
  if (here.kind === 'plugin') return `<b>${escaped(here.name)}</b>`;
  if (here.kind === 'settings') return '<span class="plain">Settings</span>';
  return `<span class="plain">${starting ? 'Starting…' : 'Plugins'}</span>`;
}

/**
 * The switcher: the filter, every Plugin in the Plugin Order or the one
 * sentence that stands in for the list, and the key line. Its script filters
 * the rows, works the keys and closes it when it loses the focus. What was
 * typed and which row the arrows are on live in the page, not in the main
 * process, so the script puts them back after each body. `opened` counts each
 * time it opens, so that the page starts again from an empty filter and the
 * open Plugin each time, and only then.
 */
export function switcherPage(view: SwitcherView): Written {
  const { open, plugins, opened, instant, restarting } = view;
  const rows =
    plugins.kind === 'untold'
      ? '<p class="none" data-key="said">The Host would not say which Plugins there are.</p>'
      : plugins.plugins.length === 0
        ? '<p class="none" data-key="said">No Plugin is registered. Add one with \
<code>firstmate add</code>.</p>'
        : `${plugins.plugins.map((plugin) => switcherRow(plugin, open, restarting)).join('\n')}
<p class="none" data-key="no-match" hidden></p>`;
  return written(
    'Plugins',
    switcherStyles(),
    `<div class="panel" data-opened="${opened}"${instant ? ' data-instant' : ''}>
<label class="find">${icon('magnifying-glass')}<input id="filter" type="text" \
placeholder="Filter Plugins" aria-label="Filter Plugins" autocomplete="off" spellcheck="false" \
role="combobox" aria-controls="rows" aria-expanded="true"></label>
<div class="rows" id="rows" role="menu" aria-label="Plugins">
${rows}
</div>
<div class="keys" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span>\
<span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
</div>`,
    SWITCHER_SCRIPT,
    ['check', 'magnifying-glass', 'arrow-clockwise'],
  );
}

/**
 * One row of the switcher. A Plugin with no Plugin Page has nowhere to go, so
 * it is shown and not offered. A Stopped Plugin is still offered, since the
 * Host serves its page whatever its Plugin Server does, and it carries a
 * Restart button of its own.
 */
function switcherRow(
  plugin: PluginSeen,
  open: string | undefined,
  restarting: readonly string[],
): string {
  const name = escaped(plugin.name);
  const here = plugin.hasPage && plugin.name === open;
  const waiting = restarting.includes(plugin.name);
  const again =
    plugin.state !== 'stopped'
      ? ''
      : `<button class="again" type="button" data-ask="${escaped(restartAsk(plugin.name))}"\
${waiting ? ' aria-disabled="true"' : ''} title="Start its Plugin Server again">\
${icon('arrow-clockwise')}${waiting ? 'Restarting…' : 'Restart'}</button>`;
  const offer = plugin.hasPage
    ? ` data-ask="${escaped(openAsk(plugin.name))}"${here ? ' aria-current="page"' : ''}`
    : ' aria-disabled="true"';
  return `<div class="row" role="menuitem" id="row-${name}" data-key="${name}"${offer}>\
<span class="dot ${plugin.state}" aria-hidden="true"></span><span class="name">${name}</span>\
<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>${again}\
<span class="tick" aria-hidden="true">${here ? icon('check') : ''}</span></div>`;
}

/**
 * The switcher's own script. The filter matches any part of a Plugin Name,
 * in any case. The arrows move over the rows the filter leaves that can be
 * opened, and the filter keeps the focus, so typing never stops. A body
 * resets what the script set on the rows, so `apply` sets it again after
 * each one. A fade runs only for a new opening from the pointer, and never
 * when the system asks for less motion.
 */
const SWITCHER_SCRIPT = `const filter = () => document.getElementById('filter');
const close = () => { filter().value = ''; firstmate.ask('${ASK.switcherClose}'); };
const allRows = () => Array.from(document.querySelectorAll('.row'));
const shownRows = () => allRows().filter((row) => !row.hidden);
const offered = () => shownRows().filter((row) => row.getAttribute('aria-disabled') !== 'true');
let opened;
let on;
const apply = () => {
  const typed = filter().value.trim();
  for (const row of allRows()) {
    row.hidden = !row.dataset.key.toLowerCase().includes(typed.toLowerCase());
  }
  const none = document.querySelector('[data-key="no-match"]');
  if (none !== null) {
    none.hidden = shownRows().length > 0;
    none.textContent = 'No Plugin matches ' + typed + '.';
  }
  const can = offered();
  if (!can.some((row) => row.dataset.key === on)) on = can[0]?.dataset.key;
  for (const row of allRows()) row.classList.toggle('on', row.dataset.key === on);
  const at = can.find((row) => row.dataset.key === on);
  if (at) filter().setAttribute('aria-activedescendant', at.id);
  else filter().removeAttribute('aria-activedescendant');
};
whenShown(() => {
  const panel = document.querySelector('.panel');
  if (panel === null) return;
  if (panel.dataset.opened !== opened) {
    opened = panel.dataset.opened;
    filter().value = '';
    on = document.querySelector('.row[aria-current]')?.dataset.key;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (panel.dataset.instant === undefined && !still) {
      panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ${FADE_MS}, easing: 'ease-out' });
    }
  }
  apply();
  // A button that went away, such as Restart once it worked, gives the
  // focus back to the filter.
  if (document.activeElement === document.body) filter().focus();
});
addEventListener('input', apply);
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key === 'Enter') {
    // Enter on a button presses that button, not the row.
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    const at = offered().find((row) => row.dataset.key === on);
    if (at) { filter().value = ''; firstmate.ask(at.dataset.ask); }
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const rows = offered();
  const at = rows.findIndex((row) => row.dataset.key === on);
  const by = event.key === 'ArrowDown' ? 1 : -1;
  const next = rows[at < 0 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1)];
  if (next === undefined) return;
  on = next.dataset.key;
  apply();
  next.scrollIntoView({ block: 'nearest' });
});
// A click anywhere else in the window takes the focus away from the switcher.
addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 120));`;

/**
 * One of the App's own pages, from its title, its style, its body, its own
 * script and the icons any body of it may draw.
 */
export function written(
  title: string,
  style: string,
  body: string,
  script = '',
  icons: readonly IconName[] = [],
): Written {
  return { whole: (now) => page(title, style, now, script, icons), body };
}

/**
 * One whole page: its policy, the shared look and its own style, the sprite of
 * its icons, its body, and the one script every page shares. The sprite sits
 * outside the body, so a new body never sends it again. That script sends a
 * click on anything with `data-ask` to the main process, or what its
 * `data-keys` says when the click came from the keyboard. It puts each body
 * the main process sends in place of the one shown, changing only what
 * differs.
 */
function page(
  title: string,
  style: string,
  body: string,
  script: string,
  icons: readonly IconName[],
): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<title>${title}</title>
<style>
${THEME_STYLE}
#shown { display: contents; }
${style}
</style>
${sprite(icons)}
<div id="shown">${body}</div>
<script>
addEventListener('click', (event) => {
  const asking = event.target instanceof Element ? event.target.closest('[data-ask]') : null;
  if (asking === null) return;
  event.preventDefault();
  if (asking.getAttribute('aria-disabled') === 'true') return;
  // A click with no pointer behind it came from the keyboard.
  firstmate.ask(event.detail === 0 && asking.dataset.keys ? asking.dataset.keys : asking.dataset.ask);
});
${PUT_IN_PLACE}
${script}
</script>
</html>`;
}

/**
 * The part of the shared script that puts a new body in place. Two nodes are
 * the same node when their kind, their tag and their `data-key` agree; a
 * node that stays keeps everything the operator gave it. A field keeps what
 * was typed in it, because a changed `value` attribute changes only a field
 * nobody typed in. A box shows what the main process says, not the last click.
 */
const PUT_IN_PLACE = `const keyOf = (node) => (node instanceof Element ? node.getAttribute('data-key') : null);
const alike = (a, b) =>
  a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
const patch = (live, next) => {
  if (!(live instanceof Element)) {
    if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    return;
  }
  for (const { name } of Array.from(live.attributes)) {
    if (!next.hasAttribute(name)) live.removeAttribute(name);
  }
  for (const { name, value } of Array.from(next.attributes)) {
    if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
  if (live instanceof HTMLInputElement && (live.type === 'checkbox' || live.type === 'radio')) {
    live.checked = live.defaultChecked;
  }
  patchChildren(live, next);
};
const patchChildren = (live, next) => {
  const spare = Array.from(live.childNodes);
  Array.from(next.childNodes).forEach((wanted, at) => {
    const found = spare.findIndex((node) => alike(node, wanted));
    const node = found < 0 ? wanted : spare.splice(found, 1)[0];
    if (found >= 0) patch(node, wanted);
    if (live.childNodes[at] !== node) live.insertBefore(node, live.childNodes[at] ?? null);
  });
  for (const node of spare) node.remove();
};
const settled = [];
const whenShown = (hook) => {
  settled.push(hook);
  hook();
};
firstmate.shown((body) => {
  const next = document.createElement('template');
  next.innerHTML = body;
  patchChildren(document.getElementById('shown'), next.content);
  for (const hook of settled) hook();
});`;

function stripStyles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--chrome); }
  body { color: var(--text); font: 13px/1 var(--sans); user-select: none; }
  /* The strip is the title bar: the window is dragged from anywhere in it but
     the parts that go somewhere. */
  .bar {
    height: 40px; display: flex; align-items: center; gap: 2px; min-width: 0;
    padding: 0 6px 0 8px; border-bottom: 1px solid var(--line);
    -webkit-app-region: drag;
  }
  a { color: inherit; text-decoration: none; -webkit-app-region: no-drag; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .crumb {
    display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 8px;
    border-radius: var(--radius-control); white-space: nowrap; color: var(--muted); min-width: 0;
  }
  .crumb:hover, .crumb[aria-expanded='true'] { background: var(--hover); color: var(--ink); }
  .crumb:active { background: var(--press); }
  .crumb[aria-disabled='true'] { pointer-events: none; }
  .crumb .mark { width: 16px; height: 16px; color: var(--brand); }
  .crumb.here { flex: 0 1 auto; overflow: hidden; color: var(--ink); }
  .crumb.here b { font: 600 12.5px/1 var(--mono); overflow: hidden; text-overflow: ellipsis; }
  .crumb.here .plain { font-weight: 600; }
  .crumb .caret { width: 12px; height: 12px; color: var(--faint); transition: transform .18s var(--ease); }
  .crumb[aria-expanded='true'] .caret { transform: rotate(180deg); }
  .sep { width: 12px; height: 12px; color: var(--faint); }
  .drag { flex: 1; align-self: stretch; }
  .fault {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0; margin-left: 8px;
    color: var(--stopped); font-size: 12.5px; white-space: nowrap; overflow: hidden;
  }
  .fault svg.i { width: 14px; height: 14px; }
  .fault span { overflow: hidden; text-overflow: ellipsis; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px 0 8px;
    border-radius: 999px; font-size: 12px; white-space: nowrap; flex: none;
    background: var(--stopped-soft); color: var(--stopped);
  }
  .pill:hover { filter: brightness(1.15); }
  .gear {
    display: inline-flex; align-items: center; height: 28px; padding: 0 8px; flex: none;
    border-radius: var(--radius-control); color: var(--muted);
  }
  .gear:hover { background: var(--hover); color: var(--ink); }
  .gear:active, .gear[aria-pressed='true'] { background: var(--press); color: var(--ink); }
  @media (prefers-reduced-motion: reduce) { .crumb .caret { transition: none; } }
  @media (max-width: 520px) { .crumb .lbl, .pill .w { display: none; } }`;
}

function switcherStyles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--raised); }
  body { color: var(--text); font: 13px/1 var(--sans); user-select: none; }
  .panel {
    height: 100vh; display: flex; flex-direction: column;
    background: var(--raised); border: 1px solid var(--line-2);
  }
  /* Each part is as tall as switcherHeight counts it. */
  .find {
    flex: none; display: flex; align-items: center; gap: 8px; height: ${FILTER}px;
    padding: 0 10px; border-bottom: 1px solid var(--line); color: var(--faint);
  }
  .find svg.i { flex: none; width: 14px; height: 14px; }
  .find input {
    flex: 1; min-width: 0; border: 0; padding: 0; background: none; outline: 0;
    color: var(--ink); font: 13px/1 var(--sans);
  }
  .find input::placeholder { color: var(--faint); }
  .rows { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }
  .row {
    display: flex; align-items: center; gap: 10px; height: ${ROW}px; padding: 0 8px;
    border-radius: var(--radius-control); cursor: pointer;
  }
  .row[hidden], .none[hidden] { display: none; }
  .row:hover, .row.on { background: var(--hover); }
  .row[aria-disabled='true'] { cursor: default; opacity: .55; }
  .row[aria-disabled='true']:hover { background: none; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 600 12.5px/1 var(--mono); color: var(--text);
  }
  .row[aria-current='page'] .name { color: var(--ink); }
  .state { flex: none; font-size: 11.5px; color: var(--faint); }
  .state.stopped { color: var(--stopped); }
  .again {
    flex: none; display: inline-flex; align-items: center; gap: 5px; height: 22px;
    padding: 0 8px; border-radius: var(--radius-control); border: 1px solid var(--line-2);
    background: var(--bg); color: var(--text); font: 11.5px/1 var(--sans); cursor: pointer;
  }
  .again svg.i { width: 12px; height: 12px; }
  .again:hover { border-color: var(--faint); color: var(--ink); }
  .again:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .again[aria-disabled='true'] { cursor: default; color: var(--muted); border-color: var(--line-2); }
  .tick { flex: none; width: 14px; color: var(--accent); }
  .tick svg.i { width: 14px; height: 14px; }
  .none { margin: 0; padding: 9px 10px; line-height: 16px; color: var(--muted); font-size: 12.5px; }
  .none code { font: 12px/1 var(--mono); color: var(--text); }
  .keys {
    flex: none; display: flex; align-items: center; gap: 14px; height: ${KEYS}px;
    padding: 0 12px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--faint);
  }
  kbd {
    display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 4px;
    text-align: center; border: 1px solid var(--line-2); border-bottom-width: 2px;
    background: var(--bg); font: 11px/15px var(--sans); color: var(--text);
  }`;
}

/** A Plugin Name, or anything else read from a file, is written as text. */
export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
