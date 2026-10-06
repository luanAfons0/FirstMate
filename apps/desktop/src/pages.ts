/**
 * The App's own pages: the strip and the switcher, and what every one of the
 * App's pages shares. The Settings View is `settings-view.ts`.
 *
 * The strip says where the window is as a breadcrumb, FirstMate and then the
 * Plugin that is open, and each part goes somewhere: FirstMate to the Index
 * Page, the last part to the switcher, which lists every Plugin in the Plugin
 * Order. Beside it are "open in browser" and the gear that opens the Settings
 * View. It is the 1.x strip, carried over.
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
import { ASK, openAsk } from './ask.ts';
import type { Plugins } from './host-lists.ts';

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
};

/** How tall the strip is, in logical pixels. */
export const STRIP_HEIGHT = 44;

/** How wide the switcher is, in logical pixels. */
export const SWITCHER_WIDTH = 360;

/** How far the switcher sits from the window's left edge, under the breadcrumb. */
export const SWITCHER_LEFT = 8;

/** How tall one row of the switcher is, and the space around the rows. */
const ROW = 34;
const AROUND = 10;

/**
 * What a page may do. It runs its own inline script and style and nothing
 * else: it loads nothing, connects nowhere and is framed by nothing.
 */
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'";

/** How tall the switcher needs to be to show every row. The window holds it
 *  inside its own height, and the rows scroll past that. */
export function switcherHeight(plugins: Plugins): number {
  const rows = plugins.kind === 'told' ? Math.max(plugins.plugins.length, 1) : 1;
  return rows * ROW + AROUND;
}

/** A page, as the address a view loads it from. */
export function dataAddress(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** The strip. */
export function stripPage(view: StripView): Written {
  const atTheList = view.here.kind === 'list';
  const crumbs = `<a class="crumb" href="#" data-ask="${ASK.pluginList}"\
${atTheList ? ' aria-disabled="true"' : ''} title="See the Plugin list">\
${icon('house')} FirstMate</a>
${icon('caret-right', 'sep')}
<a class="crumb last" href="#" data-ask="${view.switcher ? ASK.switcherClose : ASK.switcher}" \
aria-expanded="${view.switcher}"${view.starting ? ' aria-disabled="true"' : ''} \
title="Switch Plugin">${hereWords(view.here, view.starting)} \
${icon('caret-down', 'caret')}</a>`;
  return written(
    'FirstMate',
    stripStyles(),
    `<nav class="bar">
${crumbs}
${view.fault === undefined ? '' : `<span class="fault">${escaped(view.fault)}</span>`}
<span class="gap"></span>
<a class="button" href="#" data-ask="${ASK.openInBrowser}"\
${view.starting ? ' aria-disabled="true"' : ''} \
title="Open what is shown here in the system browser">open in browser</a>
<a class="button gear" href="#" data-ask="${ASK.settings}" title="Settings" aria-label="Settings" \
aria-pressed="${view.here.kind === 'settings'}">${icon('gear-six')}</a>
</nav>`,
    '',
    STRIP_ICONS,
  );
}

/** The icons the strip draws. */
const STRIP_ICONS: readonly IconName[] = ['house', 'caret-right', 'caret-down', 'gear-six'];

/** The last part of the breadcrumb: what is open, or that the Host still starts. */
function hereWords(here: Here, starting: boolean): string {
  if (here.kind === 'plugin') return `<b>${escaped(here.name)}</b>`;
  if (here.kind === 'settings') return '<b>Settings</b>';
  return starting ? 'Starting…' : 'Plugins';
}

/**
 * The switcher: every Plugin, or the one sentence that stands in for the
 * list. Its script works its keys and closes it when it loses the focus.
 * `opened` counts each time it opens, so that the page puts the focus on the
 * open Plugin each time, and only then.
 */
export function switcherPage(open: string | undefined, plugins: Plugins, opened: number): Written {
  const rows =
    plugins.kind === 'untold'
      ? '<p class="none">The Host would not say which Plugins there are.</p>'
      : plugins.plugins.length === 0
        ? '<p class="none">No Plugin is registered.</p>'
        : plugins.plugins
            .map((plugin) => {
              const dot = `<span class="dot ${plugin.state}" aria-hidden="true"></span>`;
              const words = `${dot}<span class="name">${escaped(plugin.name)}</span>\
<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>`;
              // A Plugin with no Plugin Page has nowhere to go, so it is shown
              // and not offered. A Stopped Plugin is still offered: the Host
              // serves its page whatever its Plugin Server does.
              if (!plugin.hasPage) {
                return `<span class="row" data-key="${escaped(plugin.name)}" aria-disabled="true">${words}<span class="tick"></span></span>`;
              }
              const here = plugin.name === open;
              return `<a class="row" href="#" data-key="${escaped(plugin.name)}" \
data-ask="${escaped(openAsk(plugin.name))}"${here ? ' aria-current="page"' : ''}>${words}<span class="tick" aria-hidden="true">\
${here ? icon('check') : ''}</span></a>`;
            })
            .join('\n');
  return written(
    'Plugins',
    switcherStyles(),
    `<div class="panel" role="menu" aria-label="Plugins" data-opened="${opened}">
${rows}
</div>`,
    `const close = () => firstmate.ask('${ASK.switcherClose}');
const offered = () => Array.from(document.querySelectorAll('.panel a.row'));
let opened;
whenShown(() => {
  const panel = document.querySelector('.panel');
  if (panel === null || panel.dataset.opened === opened) return;
  opened = panel.dataset.opened;
  const start = document.querySelector('.panel a[aria-current]') || offered()[0];
  if (start) start.focus();
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const rows = offered();
  const at = rows.indexOf(document.activeElement);
  const by = event.key === 'ArrowDown' ? 1 : -1;
  const next = at < 0 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1);
  if (rows[next]) rows[next].focus();
});
// A click anywhere else in the window takes the focus away from the switcher.
addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 120));`,
    ['check'],
  );
}

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
 * outside the body, so a new body never sends it again. That script sends a click on anything with `data-ask` to the
 * main process, and puts each body the main process sends in place of the
 * one shown, changing only what differs.
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
  if (asking.getAttribute('aria-disabled') !== 'true') firstmate.ask(asking.dataset.ask);
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
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--bg); }
  body {
    color: var(--text); display: flex; flex-direction: column;
    font: 13px/1 var(--sans);
  }
  .bar {
    flex: none; height: 44px; display: flex; align-items: center; gap: 6px;
    padding: 0 10px 0 8px; min-width: 0;
  }
  a { color: inherit; text-decoration: none; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .crumb {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0;
    padding: 6px 8px; border-radius: var(--radius-control); white-space: nowrap;
    color: var(--muted);
  }
  .crumb svg.i { width: 14px; height: 14px; }
  .crumb .caret { width: 12px; height: 12px; color: var(--faint); }
  .crumb.last { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .crumb b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .crumb:hover, .crumb[aria-expanded='true'] { background: var(--hover); }
  .crumb[aria-disabled='true'] { pointer-events: none; }
  .sep { width: 12px; height: 12px; color: var(--faint); }
  .gap { flex: 1; }
  .fault {
    color: var(--stopped); min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; padding-left: 6px;
  }
  .button {
    display: inline-flex; align-items: center;
    border: 1px solid var(--line-2); border-radius: var(--radius-control);
    padding: 6px 10px; white-space: nowrap;
  }
  .button:hover { background: var(--hover); border-color: var(--faint); }
  .button[aria-disabled='true'] { opacity: .5; pointer-events: none; }
  .gear { padding: 5px 7px; }
  .gear[aria-pressed='true'] { background: var(--press); border-color: var(--faint); }`;
}

function switcherStyles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--raised); }
  body { color: var(--text); font: 13px/1 var(--sans); }
  a { color: inherit; text-decoration: none; }
  .panel {
    height: 100vh; overflow-y: auto; padding: 4px;
    background: var(--raised); border: 1px solid var(--line-2);
  }
  .row {
    display: flex; align-items: center; gap: 10px; padding: 9px 10px;
    border-radius: var(--radius-control);
  }
  a.row:hover, a.row:focus-visible { background: var(--hover); outline: 0; }
  .row[aria-disabled='true'] { opacity: .5; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 600 13px/1.2 var(--mono);
  }
  .state { flex: none; font: 11px/1 var(--mono); color: var(--muted); }
  .state.stopped { color: var(--stopped); }
  .tick { flex: none; width: 14px; color: var(--running); }
  .tick svg.i { width: 14px; height: 14px; }
  .none { margin: 0; padding: 10px; color: var(--muted); }`;
}

/** A Plugin Name, or anything else read from a file, is written as text. */
export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
