/**
 * The Settings View: the window's own page for FirstMate's settings.
 *
 * It is one file with no assets of its own, as the strip is, and for the same
 * reason the Host never serves it: every Plugin Page shares an origin with the
 * Index Page, so a settings page the Host served would be one any Plugin Page
 * could drive (ADR-0012). The program writes it, shows it in place of the
 * content view, and answers what it asks.
 *
 * It asks the way the strip asks, by trying to go to an address the program
 * refuses (ADR-0011). It changes the Plugin Order, Start at logon, and whether
 * the Host runs. The Plugin Order is changed by running the command line, as a
 * terminal would (ADR-0016). The Shelf, the Shortcuts and the Grants are shown
 * with the command that changes each, and changed from a terminal alone.
 */
import {
  ASK,
  orderAsk,
  SCHEME,
  type GrantSeen,
  type Plugins,
  type Saved,
} from './desktop-state.ts';
import { STATE_WORDS } from '@firstmate/host/index-page';
import type { Shortcut } from '@firstmate/core/shortcut';
import { escaped } from './strip.ts';

/** Whether the window can move a Plugin in the Plugin Order right now. */
export type Mover =
  /** It is still finding the command line to run. */
  | { readonly kind: 'asking' }
  /** It can. */
  | { readonly kind: 'ready' }
  /** One move is running, and the next waits for it. */
  | { readonly kind: 'busy' }
  /** It cannot, and this is the sentence that says why. */
  | { readonly kind: 'cannot'; readonly why: string };

/** Everything the Settings View says. It is written again when any of it changes. */
export type SettingsView = {
  /** Every Plugin the Host last named, in the Plugin Order. */
  readonly plugins: Plugins;
  readonly mover: Mover;
  /** Whether FirstMate starts at logon. */
  readonly logon: boolean;
  /** Whether the Host answered the last time it was asked. */
  readonly running: boolean;
  /** The Shelf, the Shortcuts and the Grants, or why they are not here yet. */
  readonly saved: Saved | { readonly kind: 'reading' };
};

/** The Settings View, as one HTML document. */
export function settingsPage(view: SettingsView): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Settings</title>
<style>
${styles()}
</style>
<main>
<h1>Settings</h1>
${orderSection(view)}
${windowSection(view)}
${savedSections(view.saved)}
</main>
<script>
${script()}
</script>
</html>`;
}

/** The Plugin Order, with a handle and two arrows on every row. */
function orderSection(view: SettingsView): string {
  const head = `<section>
<h2>Plugin Order</h2>
<p class="hint">Every list of Plugins shows them in this order: the Plugin list, the switcher and
the Tray menu. Drag a Plugin, or move it with its arrows.</p>`;
  if (view.plugins.kind === 'untold') {
    return `${head}<p class="none">The Host would not say which Plugins there are.</p></section>`;
  }
  if (view.plugins.plugins.length === 0) {
    return `${head}<p class="none">No Plugin is registered.</p></section>`;
  }
  const movable = view.mover.kind === 'ready';
  const last = view.plugins.plugins.length;
  const rows = view.plugins.plugins
    .map((plugin, at) => {
      const position = at + 1;
      const name = escaped(plugin.name);
      const arrow = (to: number, label: string, glyph: string): string =>
        movable && to >= 1 && to <= last
          ? `<a class="arrow" href="${orderAsk(plugin.name, to)}" aria-label="${label} ${name}">${glyph}</a>`
          : `<span class="arrow" aria-hidden="true">${glyph}</span>`;
      return `<li data-name="${name}" data-position="${position}"${movable ? ' draggable="true"' : ''}>\
<span class="handle" aria-hidden="true">⋮⋮</span>\
<span class="dot ${plugin.state}" aria-hidden="true"></span>\
<span class="name">${name}</span>\
<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>\
${arrow(position - 1, 'Move up', '↑')}${arrow(position + 1, 'Move down', '↓')}</li>`;
    })
    .join('\n');
  return `${head}
<ol id="order"${movable ? '' : ' class="still"'}>
${rows}
</ol>
${moverNote(view.mover)}
</section>`;
}

function moverNote(mover: Mover): string {
  if (mover.kind === 'asking') return '<p class="none">Finding the command line…</p>';
  if (mover.kind === 'busy') return '<p class="none">Moving…</p>';
  if (mover.kind === 'cannot') return `<p class="none">${escaped(mover.why)}</p>`;
  return '';
}

/** What the window itself does: start at logon, and start the Host again. */
function windowSection(view: SettingsView): string {
  return `<section>
<h2>FirstMate</h2>
<a class="line" href="${ASK.logon}" role="switch" aria-checked="${view.logon}">
  <span>Start at logon</span><span class="switch" aria-hidden="true"></span>
</a>
<a class="line" href="${ASK.restart}">
  <span>${view.running ? 'Restart FirstMate' : 'Start FirstMate'}</span>
  <span class="note">Every Plugin Server starts again.</span>
</a>
</section>`;
}

/** The Shelf, the Shortcuts and the Grants: shown, and changed from a terminal. */
function savedSections(saved: SettingsView['saved']): string {
  if (saved.kind === 'reading') {
    return '<section><h2>Shelf, Shortcuts and Grants</h2><p class="none">Reading…</p></section>';
  }
  if (saved.kind === 'unread') {
    return `<section><h2>Shelf, Shortcuts and Grants</h2>
<p class="none">They could not be read: ${escaped(saved.why)}</p></section>`;
  }
  return `<section>
<h2>Shelf</h2>
<p class="hint">Where a fetched Plugin lands, unless <code>FIRSTMATE_SHELF</code> is set where the
Host runs.</p>
<p class="value"><code>${escaped(saved.shelf)}</code></p>
${commands(['firstmate shelf <dir>'])}
</section>
<section>
<h2>Shortcuts</h2>
${
  saved.shortcuts.length === 0
    ? '<p class="none">No Shortcut is bound.</p>'
    : `<ul class="table">${saved.shortcuts.map(shortcutRow).join('\n')}</ul>`
}
${commands(['firstmate bind <keys> <plugin> [path]', 'firstmate unbind <keys>'])}
</section>
<section>
<h2>Grants</h2>
${
  saved.grants.length === 0
    ? '<p class="none">No Plugin may call another.</p>'
    : `<ul class="table">${saved.grants.map(grantRow).join('\n')}</ul>`
}
${commands(['firstmate grant <from> <to>', 'firstmate revoke <from> <to>'])}
</section>`;
}

function shortcutRow(shortcut: Shortcut): string {
  return `<li><kbd>${escaped(shortcut.keys)}</kbd><code>/p/${escaped(shortcut.plugin)}/\
${escaped(shortcut.path)}</code></li>`;
}

function grantRow(grant: GrantSeen): string {
  return `<li><code>${escaped(grant.from)}</code><span class="sep">→</span>\
<code>${escaped(grant.to)}</code><span class="note">may call its tools</span></li>`;
}

/** The commands that change a setting, written exactly, to be typed in a terminal. */
function commands(lines: readonly string[]): string {
  return `<p class="commands">${lines.map((line) => `<code>${escaped(line)}</code>`).join('')}</p>`;
}

/**
 * The view's one script. It asks for things the way a link does, so it needs
 * nothing injected: Esc closes the view, and a drop asks to move the Plugin to
 * where it was dropped. The rows are written again from what the Host says,
 * so a move that fails never stays on screen as if it had been kept.
 */
function script(): string {
  return `(() => {
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); location.href = '${ASK.settings}'; }
  });
  const list = document.getElementById('order');
  if (!list || list.classList.contains('still')) return;
  let dragged = null;
  list.addEventListener('dragstart', (event) => {
    dragged = event.target.closest('li');
    if (!dragged) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.dataset.name);
    dragged.classList.add('dragging');
  });
  list.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    const over = event.target.closest('li');
    if (!over || over === dragged) return;
    const box = over.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    list.insertBefore(dragged, after ? over.nextSibling : over);
  });
  list.addEventListener('drop', (event) => event.preventDefault());
  list.addEventListener('dragend', () => {
    if (!dragged) return;
    const row = dragged;
    dragged = null;
    row.classList.remove('dragging');
    const position = Array.from(list.children).indexOf(row) + 1;
    if (position !== Number(row.dataset.position)) {
      location.href = '${SCHEME}order/' +
        encodeURIComponent(row.dataset.name) + '/' + position;
    }
  });
})();`;
}

function styles(): string {
  return `:root {
  color-scheme: light dark;
  --paper: #fcfcfb;
  --raised: #ffffff;
  --ink: #16181d;
  --muted: #6b7280;
  --faint: #a4abb5;
  --line: rgba(22, 24, 29, .11);
  --live: #157f57;
  --stopped: #b3261e;
  --focus: #2f6feb;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #131519;
    --raised: #1a1d23;
    --ink: #e7e9ec;
    --muted: #98a0aa;
    --faint: #666d78;
    --line: rgba(231, 233, 236, .13);
    --live: #4ecb96;
    --stopped: #ff6f61;
    --focus: #7aa2f7;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--ink); background: var(--paper);
  font: 15px/1.5 system-ui, sans-serif;
}
main { margin: 0 auto; padding: 2.5rem 1rem 4rem; max-width: 40rem; }
h1 { font-size: 1.0625rem; font-weight: 600; margin: 0 0 1.5rem; }
h2 {
  font-size: .75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--muted); margin: 0 0 .5rem;
}
section { padding: 1.25rem 0; border-top: 1px solid var(--line); }
p { margin: 0 0 .75rem; }
.hint, .none, .note { color: var(--muted); font-size: .8125rem; }
.none { color: var(--faint); }
code, kbd { font-family: var(--mono); font-size: .8125rem; }
a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; border-radius: 6px; }

ol { list-style: none; margin: 0 0 .5rem; padding: 0; }
ol li {
  display: flex; align-items: center; gap: .65rem; padding: .55rem .6rem;
  margin: 0 -.6rem; border-radius: 7px; user-select: none;
}
ol li[draggable='true'] { cursor: grab; }
ol li + li { border-top: 1px solid var(--line); }
ol li:hover { background: var(--raised); }
ol li.dragging { opacity: .45; }
.handle { color: var(--faint); letter-spacing: -.2em; font-size: .75rem; width: .9rem; }
ol.still .handle { visibility: hidden; }
.name { flex: 1; min-width: 0; font: 600 .9375rem var(--mono); overflow: hidden; text-overflow: ellipsis; }
.state { font: .75rem var(--mono); color: var(--muted); }
.state.stopped { color: var(--stopped); }
.state.no-plugin-server { color: var(--faint); }
.dot { flex: none; width: .5rem; height: .5rem; border-radius: 50%; background: var(--live); }
.dot.stopped { background: var(--stopped); }
.dot.no-plugin-server { background: none; box-shadow: inset 0 0 0 1.5px var(--faint); }
.arrow {
  flex: none; width: 1.75rem; height: 1.75rem; display: grid; place-items: center;
  border-radius: 6px; color: var(--muted);
}
a.arrow:hover { background: var(--paper); box-shadow: 0 0 0 1px var(--line); color: var(--ink); }
span.arrow { color: var(--line); }

.line {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: .6rem .6rem; margin: 0 -.6rem; border-radius: 7px;
}
.line:hover { background: var(--raised); box-shadow: 0 0 0 1px var(--line); }
.switch {
  flex: none; width: 2.1rem; height: 1.2rem; border-radius: 1rem; position: relative;
  background: var(--line);
}
.switch::after {
  content: ''; position: absolute; top: .15rem; left: .15rem; width: .9rem; height: .9rem;
  border-radius: 50%; background: var(--paper); box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
}
[aria-checked='true'] .switch { background: var(--live); }
[aria-checked='true'] .switch::after { left: 1.05rem; }

.value code { font-size: .875rem; }
.table { list-style: none; margin: 0 0 .75rem; padding: 0; }
.table li { display: flex; align-items: baseline; gap: .75rem; padding: .35rem 0; }
.table li + li { border-top: 1px solid var(--line); }
kbd {
  padding: .1rem .4rem; border-radius: 5px; background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
}
.sep { color: var(--faint); }
.commands { display: flex; flex-wrap: wrap; gap: .4rem .9rem; margin: 0; }
.commands code { color: var(--muted); }
@media (prefers-reduced-motion: no-preference) {
  ol li, .line, .switch, .switch::after { transition: background .1s ease, left .12s ease; }
}`;
}
