/**
 * The Settings View: a side list of its sections, the Places with their
 * Shelves, the Plugin Order, start at logon, the Shortcuts, the way to each
 * Plugin's Plugin Settings, and the App's version.
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can reach it (ADR-0008). A change elsewhere on the page keeps
 * what the operator typed in a field; a form whose change was done is emptied
 * back to what it now says, and one that was refused keeps the typed text, so
 * the operator can correct it. What the operator types goes to the main
 * process as one ask, every part encoded, and the main process changes it
 * through `core` (`settings.ts`). The page checks nothing itself: `core`
 * refuses what is wrong, in the sentence a terminal would see, and the page
 * shows it in the outcome line, which stays in view while the page scrolls,
 * and under the field the refusal is about.
 *
 * Add a Place opens and closes in place, with no modal, and only where a
 * `wsl` Place can be (ADR-0021): elsewhere the one Place is this machine.
 * Whether it is open is the page's own state, which it sets again after
 * every body, as it does which section of the side list is current.
 *
 * The Plugin Order is the rows `/plugins.json` gave, each with its position
 * and its state. A drag, Alt+↑ or Alt+↓, or a row's up or down button sends
 * one ask: the Plugin Name and its new position. The page never moves a row
 * itself; it shows the order the Host gives back, so a refused move leaves
 * the rows where they are kept (ADR-0016). The row that moved keeps the
 * focus, so the keys can move it again.
 *
 * Plugin settings lists the same rows. Each Plugin with a Plugin Page has an
 * Open settings button, whose ask carries the Plugin Name alone; the main
 * process opens `/p/<name>/#settings` in that Plugin's own view. The App
 * shows the button whether or not the Plugin has settings, and reads and
 * writes none of them (ADR-0029).
 */
import { canHoldWslPlace } from '@firstmate/core/places';
import { STATE_WORDS } from '@firstmate/core/plugin-state';
import { shortcutAddress } from '@firstmate/core/shortcut';
import { type IconName, icon } from '@firstmate/core/theme';
import { logonAsk, placeRemoveAsk, pluginSettingsAsk, shelfChooseAsk, TYPED } from './ask.ts';
import { escaped, written, type Written } from './pages.ts';
import type { PluginSeen, Plugins } from './host-lists.ts';
import type { Field, PlaceShown, SettingsShown, ShortcutShown } from './settings.ts';

/** One section of the Settings View, as the side list names it. */
type Section = { readonly id: string; readonly icon: IconName; readonly words: string };

/** The sections, in the order the page shows them and the side list names them. */
const SECTIONS: readonly Section[] = [
  { id: 'places', icon: 'hard-drives', words: 'Places' },
  { id: 'order', icon: 'list-numbers', words: 'Plugin Order' },
  { id: 'logon', icon: 'power', words: 'Start at logon' },
  { id: 'shortcuts', icon: 'keyboard', words: 'Shortcuts' },
  { id: 'plugin-settings', icon: 'puzzle-piece', words: 'Plugin settings' },
];

/** The icons any body of the Settings View may draw. */
const ICONS: readonly IconName[] = [
  ...SECTIONS.map((section) => section.icon),
  'terminal-window',
  'folder-open',
  'trash',
  'plus',
  'circle-notch',
  'check-circle',
  'warning-circle',
  'dots-six-vertical',
  'caret-up',
  'caret-down',
];

/** The Settings View. */
export function settingsPage(shown: SettingsShown): Written {
  const read = shown.saved.kind === 'read';
  const pane =
    shown.saved.kind === 'unread'
      ? `<section><div class="unread"><b>${icon('warning-circle')}The settings could not be read</b>
<p>${escaped(shown.saved.why)}</p></div></section>`
      : `${outcomeLine(shown)}
${placesSection(shown.saved.places, shown)}
${orderSection(shown.plugins, shown.busy)}
${logonSection(shown.logon, shown.busy)}
${shortcutsSection(shown.saved.shortcuts)}
${pluginSettingsSection(shown.plugins)}
<p class="foot">Plugins and Grants change from a terminal: <code>firstmate --help</code>.</p>`;
  return written(
    'Settings',
    styles(),
    `<div class="settings">
<nav class="side" aria-label="Settings">
<h1>Settings</h1>
${read ? SECTIONS.map(sideLink).join('\n') : ''}
<p class="ver">FirstMate ${escaped(shown.version)}</p>
</nav>
<main class="pane"${shown.busy ? ' aria-busy="true"' : ''}>
${pane}
</main>
</div>`,
    script(),
    ICONS,
  );
}

function sideLink(section: Section): string {
  return (
    `<a href="#${section.id}" data-to="${section.id}">` +
    `${icon(section.icon)}${section.words}</a>`
  );
}

function outcomeLine(shown: SettingsShown): string {
  if (shown.busy) {
    return (
      `<div class="outcome" role="status">${icon('circle-notch', 'spin')}` +
      '<span>Working…</span></div>'
    );
  }
  if (shown.outcome === undefined) return '';
  const { done, sentence } = shown.outcome;
  return `<div class="outcome ${done ? 'done' : 'refused'}" role="status">\
${icon(done ? 'check-circle' : 'warning-circle')}<span>${escaped(sentence)}</span></div>`;
}

/** The sentence under a field, and its mark, when the last refusal was about it. */
function mark(shown: SettingsShown, field: Field): { readonly on: string; readonly under: string } {
  const at = shown.busy ? undefined : shown.outcome?.field;
  if (at === undefined || shown.outcome === undefined || keyOf(at) !== keyOf(field)) {
    return { on: '', under: '' };
  }
  return {
    on: ' aria-invalid="true"',
    under: `<span class="err">${escaped(shown.outcome.sentence)}</span>`,
  };
}

/** One field, as one string, so two can be compared. */
function keyOf(field: Field): string {
  return field.form === 'shelf' ? `shelf/${field.place}` : `place-add/${field.name}`;
}

function placesSection(places: readonly PlaceShown[], shown: SettingsShown): string {
  const rows = places.map((place) => placeRow(place, shown)).join('\n');
  const add = canHoldWslPlace() ? `\n${addPlace(shown)}` : '';
  return `<section id="places">
<h2>Places</h2>
<p class="hint">A Place is where Plugins are installed and run. Each Place has its own Shelf, where
<code>firstmate install</code> puts a Plugin it fetches.</p>
<div class="group">
${rows}${add}
</div>
</section>`;
}

/**
 * Add a Place: one button, and the form it opens in place. Both are written
 * every time; the page's script says which of them shows.
 */
function addPlace(shown: SettingsShown): string {
  const field = (name: 'name' | 'kind' | 'distribution') =>
    mark(shown, { form: 'place-add', name });
  const name = field('name');
  const kind = field('kind');
  const distribution = field('distribution');
  return `<div class="addrow" data-key="add-row"><button type="button" class="btn quiet" \
data-add="open"${disabled(shown.busy)}>${icon('plus')}Add a Place</button></div>
<form class="addform" data-key="add-form" data-typed="${TYPED.placeAdd}" hidden>
<b>Add a Place</b>
<div class="cols">
<label class="field"><span>Name</span><input class="input mono" name="name" required \
placeholder="debian" autocomplete="off" spellcheck="false"${name.on}>${name.under}</label>
<label class="field"><span>Kind</span><select class="input" name="kind"${kind.on}>
<option value="wsl">wsl: a WSL distribution</option>
<option value="local">local: this machine</option>
</select>${kind.under}</label>
<label class="field for-wsl"><span>Distribution</span><input class="input" name="distribution" \
placeholder="Debian" autocomplete="off" spellcheck="false"${distribution.on}>\
${distribution.under}</label>
</div>
<div class="acts"><button type="button" class="btn" data-add="close">Cancel</button>\
<button class="btn primary"${disabled(shown.busy)}>Add</button></div>
</form>`;
}

function placeRow(place: PlaceShown, shown: SettingsShown): string {
  const name = escaped(place.name);
  const busy = shown.busy;
  const wsl = place.kind === 'wsl';
  const tag = wsl
    ? `wsl · ${escaped(place.distribution ?? '')}`
    : place.kind === 'local'
      ? 'this machine'
      : escaped(place.kind);
  // A local Place's Shelf is a folder on this machine, so it can be chosen; a
  // wsl Place's is a path inside the distribution, so it is typed.
  const choose = wsl
    ? ''
    : `<button type="button" class="btn" data-ask="${escaped(shelfChooseAsk(place.name))}"\
${disabled(busy)}>${icon('folder-open')}Choose…</button>`;
  const end = place.always
    ? 'Always here'
    : place.plugins.length > 0
      ? `Holds ${escaped(place.plugins.join(', '))}`
      : `<button type="button" class="btn quiet remove" title="Remove this Place" \
data-ask="${escaped(placeRemoveAsk(place.name))}"${disabled(busy)}>${icon('trash')}Remove</button>`;
  const shelf = mark(shown, { form: 'shelf', place: place.name });
  return `<div class="place" data-key="place:${name}">
<div class="head">${icon(wsl ? 'terminal-window' : 'hard-drives')}<b>${name}</b>\
<span class="tag">${tag}</span><span class="end">${end}</span></div>
<form data-typed="${TYPED.shelf}" data-place="${name}">
<label class="field"><span>Shelf</span><span class="inline">\
<input class="input mono" name="directory" value="${escaped(place.shelf)}" required \
autocomplete="off" spellcheck="false" aria-label="The Shelf of ${name}"\
${shelf.on}${disabled(busy)}>\
<button class="btn"${disabled(busy)}>Move</button>${choose}</span>${shelf.under}</label>
</form>
</div>`;
}

function orderSection(plugins: Plugins, busy: boolean): string {
  const rows =
    plugins.kind === 'untold'
      ? '<p class="none">The Host would not say which Plugins there are.</p>'
      : plugins.plugins.length === 0
        ? '<p class="none">No Plugin is registered.</p>'
        : `<ol class="group${busy ? ' order-busy' : ''}" aria-label="Plugin Order">
${plugins.plugins.map((plugin, at, all) => orderRow(plugin, at + 1, all.length, busy)).join('\n')}
</ol>`;
  return `<section id="order">
<h2>Plugin Order</h2>
<p class="hint">The Index Page, the switcher and the Tray show the Plugins in this order. Drag a
row, or press <kbd>Alt</kbd>+<kbd>↑</kbd> or <kbd>Alt</kbd>+<kbd>↓</kbd>. A new Plugin goes to the
bottom.</p>
${rows}
</section>`;
}

/** One row of the Plugin Order. Running needs no word: the solid dot says it. */
function orderRow(plugin: PluginSeen, position: number, count: number, busy: boolean): string {
  const name = escaped(plugin.name);
  const state = plugin.state === 'running' ? '' : STATE_WORDS[plugin.state];
  const button = (by: -1 | 1, where: string, end: boolean) =>
    `<button type="button" class="icon-btn" data-move="${by}" tabindex="-1" \
aria-label="Move ${name} ${where}"${disabled(busy || end)}>\
${icon(by < 0 ? 'caret-up' : 'caret-down')}</button>`;
  return `<li class="order-row" data-key="order:${name}" data-name="${name}" data-at="${position}" \
draggable="${!busy}" tabindex="0" aria-label="${name}, number ${position} of ${count}">\
${icon('dots-six-vertical', 'grip')}<span class="pos">${position}</span>\
<span class="dot ${plugin.state}" aria-hidden="true"></span><span class="name">${name}</span>\
<span class="state ${plugin.state}">${state}</span><span class="moves">\
${button(-1, 'up', position === 1)}${button(1, 'down', position === count)}</span></li>`;
}

function logonSection(logon: boolean, busy: boolean): string {
  return `<section id="logon">
<h2>Start at logon</h2>
<div class="group"><div class="toggle-row"><div class="t"><b>Start FirstMate when you log on</b>
<span>It starts in the Tray, with the window hidden.</span></div>
<button type="button" class="switch" role="switch" aria-checked="${logon}" \
aria-label="Start FirstMate when you log on" data-ask="${escaped(logonAsk(!logon))}"\
${disabled(busy)}></button></div></div>
</section>`;
}

function shortcutsSection(shortcuts: readonly ShortcutShown[]): string {
  const rows =
    shortcuts.length === 0
      ? '<p class="none">No Shortcut is bound.</p>'
      : shortcuts.map(shortcutRow).join('\n');
  return `<section id="shortcuts">
<h2>Shortcuts</h2>
<p class="hint">Each Shortcut opens one address of one Plugin in a Popup. Bind and unbind them
from a terminal.</p>
<div class="group">
${rows}
</div>
<div class="cmd"><span class="p">&gt;</span>firstmate bind &lt;keys&gt; &lt;plugin&gt; [path]</div>
</section>`;
}

/**
 * One Shortcut: its keys, and the address it opens as `core` writes it, with
 * the Host's own parts of the address dimmed.
 */
function shortcutRow(shortcut: ShortcutShown): string {
  const keys = shortcut.keys
    .split('+')
    .map((key) => `<kbd>${escaped(key)}</kbd>`)
    .join('+');
  const [, plugin = '', path = ''] = /^\/p\/([^/]*)\/(.*)$/.exec(shortcutAddress(shortcut)) ?? [];
  return `<div class="shortcut" data-key="shortcut:${escaped(shortcut.keys)}">\
<span class="k">${keys}</span><code><i>/p/</i>${escaped(plugin)}<i>/</i>\
${escaped(path)}</code></div>`;
}

/** Plugin settings: every Plugin in the Plugin Order, and a way to its own settings. */
function pluginSettingsSection(plugins: Plugins): string {
  const rows =
    plugins.kind === 'untold'
      ? '<p class="none">The Host would not say which Plugins there are.</p>'
      : plugins.plugins.length === 0
        ? '<p class="none">No Plugin is registered.</p>'
        : `<div class="group">
${plugins.plugins.map(pluginSettingsRow).join('\n')}
</div>`;
  return `<section id="plugin-settings">
<h2>Plugin settings</h2>
<p class="hint">Each Plugin keeps its own settings in its own Plugin Page. Open settings shows that
page at <code>#settings</code>; a Plugin with no settings shows its page as it always does.</p>
${rows}
</section>`;
}

/**
 * One Plugin, its state, and its Open settings button. A Plugin with no
 * Plugin Page has nothing to open, so it says so. Running needs no word: the
 * solid dot says it.
 */
function pluginSettingsRow(plugin: PluginSeen): string {
  const name = escaped(plugin.name);
  const state = plugin.state === 'running' ? '' : STATE_WORDS[plugin.state];
  const end = plugin.hasPage
    ? `<button type="button" class="btn" data-ask="${escaped(pluginSettingsAsk(plugin.name))}" \
aria-label="Open the settings of ${name}">Open settings</button>`
    : '<span class="no-page">No Plugin Page</span>';
  return `<div class="plugin-row" data-key="plugin-settings:${name}">\
<span class="dot ${plugin.state}" aria-hidden="true"></span><span class="name">${name}</span>\
<span class="state ${plugin.state}">${state}</span>${end}</div>`;
}

function disabled(busy: boolean): string {
  return busy ? ' disabled' : '';
}

/**
 * Each form sends one ask: its first words, then every field it has, in
 * order, each encoded. A field left empty, such as the distribution of a
 * local Place, is left out. The form is kept until the page has shown its
 * change worked on and then ended, and it is emptied only when it was done;
 * Add a Place then closes. The side list scrolls to its section in one click.
 *
 * A move in the Plugin Order sends the Plugin Name and the position it asks
 * for, and nothing while a change is still being made. Once the page has
 * shown that move worked on and then ended, the row of that Plugin takes the
 * focus again, wherever the new body put it.
 */
function script(): string {
  return `let asking;
let adding = false;
let current = '';
const addForm = () => document.querySelector('form.addform');
const showAdding = () => {
  const form = addForm();
  const row = document.querySelector('.addrow');
  if (form) form.hidden = !adding;
  if (row) row.hidden = adding;
};
const showKind = () => {
  const kind = document.querySelector('form.addform select[name=kind]');
  const wsl = document.querySelector('form.addform .for-wsl');
  if (kind && wsl) wsl.hidden = kind.value !== 'wsl';
};
const showCurrent = () => {
  for (const link of document.querySelectorAll('.side a[data-to]')) {
    if (link.dataset.to === current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
};
const busyNow = () => document.querySelector('main[aria-busy]') !== null;
const orderRows = () => Array.from(document.querySelectorAll('.order-row'));
const rowOf = (event) =>
  event.target instanceof Element ? event.target.closest('.order-row') : null;
let moving;
const move = (row, position) => {
  if (busyNow() || position < 1 || position > orderRows().length) return;
  if (position === Number(row.dataset.at)) return;
  moving = { name: row.dataset.name, seen: false };
  const parts = ['${TYPED.pluginMove}', row.dataset.name, String(position)];
  firstmate.ask(parts.map((part, at) => at === 0 ? part : encodeURIComponent(part)).join('/'));
};
const openAdding = (open) => {
  adding = open;
  const form = addForm();
  if (!open && form) form.reset();
  showAdding();
  showKind();
  if (open && form) form.querySelector('input').focus();
  if (!open) document.querySelector('.addrow button')?.focus();
};
whenShown(() => {
  if (asking === undefined) return;
  if (document.querySelector('main[aria-busy]')) { asking.seen = true; return; }
  if (!asking.seen) return;
  if (document.querySelector('.outcome.done')) {
    asking.form.reset();
    if (asking.form === addForm()) adding = false;
  }
  asking = undefined;
});
whenShown(() => {
  if (moving === undefined) return;
  if (busyNow()) { moving.seen = true; return; }
  if (!moving.seen) return;
  const row = orderRows().find((one) => one.dataset.name === moving.name);
  moving = undefined;
  if (row && document.activeElement !== row) row.focus();
});
whenShown(showAdding);
whenShown(showKind);
whenShown(() => {
  if (current === '') current = document.querySelector('.side a[data-to]')?.dataset.to ?? '';
  showCurrent();
});
addEventListener('change', showKind);
addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const add = target?.closest('[data-add]');
  if (add) { event.preventDefault(); openAdding(add.dataset.add === 'open'); return; }
  const step = target?.closest('[data-move]');
  if (step) {
    event.preventDefault();
    const row = step.closest('.order-row');
    move(row, Number(row.dataset.at) + Number(step.dataset.move));
    return;
  }
  const link = target?.closest('.side a[data-to]');
  if (!link) return;
  event.preventDefault();
  current = link.dataset.to;
  showCurrent();
  document.getElementById(current)?.scrollIntoView({ block: 'start' });
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adding && addForm()?.contains(event.target)) openAdding(false);
  const row = rowOf(event);
  if (!row || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  move(row, Number(row.dataset.at) + (event.key === 'ArrowUp' ? -1 : 1));
});
let dragged;
const clearDrop = () => {
  for (const row of document.querySelectorAll('.drop-before, .drop-after')) {
    row.classList.remove('drop-before', 'drop-after');
  }
};
addEventListener('dragstart', (event) => {
  const row = rowOf(event);
  if (!row || busyNow()) return;
  dragged = row;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.name);
});
addEventListener('dragover', (event) => {
  const row = rowOf(event);
  if (!row || !dragged) return;
  event.preventDefault();
  clearDrop();
  if (row === dragged) return;
  const box = row.getBoundingClientRect();
  row.classList.add(event.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after');
});
addEventListener('drop', (event) => {
  const row = rowOf(event);
  if (!row || !dragged) return;
  event.preventDefault();
  const after = row.classList.contains('drop-after');
  clearDrop();
  if (row === dragged) return;
  const rest = orderRows().filter((one) => one !== dragged);
  move(dragged, rest.indexOf(row) + (after ? 2 : 1));
});
addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = undefined;
  clearDrop();
});
addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  asking = { form, seen: false };
  const parts = [form.dataset.typed];
  if (form.dataset.place !== undefined) parts.push(form.dataset.place);
  for (const field of form.querySelectorAll('input, select')) {
    if (field.closest('[hidden]') || field.value.trim() === '') continue;
    parts.push(field.value.trim());
  }
  firstmate.ask(parts.map((part, at) => at === 0 ? part : encodeURIComponent(part)).join('/'));
});`;
}

function styles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); }
  body { color: var(--text); font: 13px/1.5 var(--sans); }
  code, kbd, .mono { font-family: var(--mono); }
  code { font-size: 12.5px; color: var(--ink); }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .settings { display: grid; grid-template-columns: 188px minmax(0, 1fr); min-height: 100vh; }
  .side {
    position: sticky; top: 0; align-self: start; height: 100vh;
    border-right: 1px solid var(--line); padding: 20px 10px; background: var(--bg);
  }
  .side h1 { margin: 0 8px 12px; font-size: 15px; font-weight: 600; color: var(--ink); }
  .side a {
    display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 8px;
    border-radius: var(--radius-control); color: var(--muted); text-decoration: none;
  }
  .side a:hover { background: var(--hover); color: var(--ink); }
  .side a[aria-current="true"] { background: var(--press); color: var(--ink); }
  .side .ver { margin: 18px 8px 0; font-size: 11.5px; color: var(--faint); }
  .pane { padding: 20px 32px 48px; max-width: 760px; min-width: 0; }
  .outcome {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 9px;
    padding: 9px 12px; margin: 0 0 8px; border-radius: var(--radius-panel); font-size: 13px;
    background: var(--raised); border: 1px solid var(--line-2);
    animation: drop .18s var(--ease);
  }
  .outcome.done { color: var(--running); }
  .outcome.done span, .outcome.refused span { color: var(--text); }
  .outcome.refused {
    color: var(--stopped); border-color: color-mix(in srgb, var(--stopped) 40%, var(--line-2));
  }
  .outcome .spin { animation: spin .7s linear infinite; color: var(--accent); }
  @keyframes spin { to { transform: rotate(1turn); } }
  @keyframes drop { from { opacity: 0; transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) { .outcome, .outcome .spin { animation: none; } }
  .pane section { padding: 18px 0 8px; scroll-margin-top: 52px; }
  .pane h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--ink); }
  .pane .hint { margin: 0 0 12px; color: var(--muted); font-size: 12.5px; }
  .group {
    border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--raised);
  }
  .group > :not([hidden]) ~ :not([hidden]) { border-top: 1px solid var(--line); }
  .place { padding: 12px 14px; }
  .place .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; min-width: 0; }
  .place .head svg.i { color: var(--muted); }
  .place .head b { color: var(--ink); font-weight: 600; }
  .tag {
    white-space: nowrap; font-size: 11.5px; padding: 1px 7px; border-radius: 999px;
    background: var(--chrome); border: 1px solid var(--line); color: var(--muted);
  }
  .place .head .end {
    margin-left: auto; font-size: 12px; color: var(--faint); text-align: right;
    display: flex; align-items: center; gap: 8px;
  }
  .field { display: grid; gap: 5px; }
  .field > span:first-child { font-size: 12px; color: var(--muted); }
  .field .err { font-size: 12px; color: var(--stopped); }
  .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .inline .input { flex: 1; min-width: 220px; }
  .input {
    height: 32px; padding: 0 10px; border-radius: var(--radius-control);
    border: 1px solid var(--line-2); background: var(--bg); color: var(--ink);
    font: 13px var(--sans); outline: 0; min-width: 0;
  }
  .input.mono { font: 12.5px var(--mono); }
  .input:hover { border-color: var(--faint); }
  .input:focus-visible {
    border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline: 0;
  }
  .input[aria-invalid="true"] { border-color: var(--stopped); }
  .btn {
    height: 32px; padding: 0 12px; border-radius: var(--radius-control);
    border: 1px solid var(--line-2); background: var(--bg); color: var(--text);
    font: 13px var(--sans); cursor: pointer; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px;
  }
  .btn:hover { background: var(--hover); border-color: var(--faint); color: var(--ink); }
  .btn:active { transform: scale(.97); background: var(--press); }
  .btn.primary {
    background: var(--accent); border-color: var(--accent); color: var(--accent-ink);
    font-weight: 600;
  }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.quiet {
    border-color: transparent; background: none; color: var(--text); height: 26px;
    padding: 0 8px;
  }
  .btn.quiet:hover { background: var(--hover); }
  .btn.remove { color: var(--muted); }
  .btn.remove:hover { color: var(--stopped); }
  .btn:disabled, .input:disabled, .switch:disabled {
    opacity: .5; cursor: default; pointer-events: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .btn { transition: background .12s ease, color .12s ease, transform .12s ease-out; }
  }
  .addrow { padding: 10px 14px; }
  .addform { padding: 14px; display: grid; gap: 12px; }
  .addform > b { color: var(--ink); font-weight: 600; }
  .addform .cols {
    display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 10px; align-items: start;
  }
  .addform .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .toggle-row { display: flex; align-items: center; gap: 16px; padding: 12px 14px; }
  .toggle-row .t b { display: block; font-weight: 500; color: var(--ink); }
  .toggle-row .t span { font-size: 12.5px; color: var(--muted); }
  .switch {
    margin-left: auto; position: relative; width: 36px; height: 20px; border-radius: 999px;
    border: 0; padding: 0; background: var(--line-2); cursor: pointer; flex: none;
    transition: background .16s ease;
  }
  .switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
    transition: transform .18s var(--ease);
  }
  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(16px); }
  .shortcut {
    display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 12px;
    padding: 10px 14px;
  }
  .shortcut .k {
    display: flex; gap: 4px; align-items: center; color: var(--faint); font-size: 11px;
  }
  .shortcut code i { font-style: normal; color: var(--faint); }
  kbd {
    display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 4px;
    text-align: center;
    border: 1px solid var(--line-2); border-bottom-width: 2px; background: var(--bg);
    font-size: 11px; line-height: 15px; color: var(--text);
  }
  ol.group { list-style: none; margin: 0; padding: 0; }
  .order-row {
    display: grid; grid-template-columns: 16px 20px 8px minmax(0, 1fr) auto 60px;
    align-items: center;
    gap: 10px; padding: 6px 8px 6px 10px; cursor: grab; outline: 0; position: relative;
  }
  .order-row:hover { background: var(--hover); }
  .order-row:first-child { border-radius: var(--radius-panel) var(--radius-panel) 0 0; }
  .order-row:last-child { border-radius: 0 0 var(--radius-panel) var(--radius-panel); }
  .order-row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .order-row .grip { width: 16px; height: 16px; color: var(--faint); }
  .order-row .pos {
    font: 12px/1 var(--mono); color: var(--faint); text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .order-row .name {
    font: 600 12.5px/1.2 var(--mono); color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .order-row .state { font-size: 11.5px; color: var(--faint); }
  .order-row .state.stopped { color: var(--stopped); }
  .order-row .moves { display: flex; gap: 2px; justify-content: flex-end; opacity: 0; }
  .order-row:hover .moves, .order-row:focus-within .moves { opacity: 1; }
  @media (hover: none) { .order-row .moves { opacity: 1; } }
  .icon-btn {
    width: 26px; height: 26px; border: 0; border-radius: var(--radius-control); background: none;
    color: var(--muted); display: grid; place-items: center; cursor: pointer;
  }
  .icon-btn:hover { background: var(--press); color: var(--ink); }
  .icon-btn:disabled { opacity: .3; pointer-events: none; }
  .icon-btn svg.i { width: 14px; height: 14px; }
  @media (prefers-reduced-motion: no-preference) {
    .icon-btn { transition: transform .12s ease-out; }
    .icon-btn:active { transform: scale(.94); }
  }
  .order-row.dragging { opacity: .45; }
  .order-row.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
  .order-row.drop-after { box-shadow: inset 0 -2px 0 var(--accent); }
  .order-busy .order-row { cursor: default; opacity: .6; pointer-events: none; }
  .none { margin: 0; padding: 14px 12px; color: var(--muted); font-size: 12.5px; }
  .plugin-row {
    display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center;
    gap: 10px; padding: 8px 10px 8px 14px; min-height: 46px;
  }
  .plugin-row .name {
    font: 600 12.5px/1.2 var(--mono); color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .plugin-row .state { font-size: 11.5px; color: var(--faint); }
  .plugin-row .state.stopped { color: var(--stopped); }
  .plugin-row .no-page { font-size: 12px; color: var(--faint); }
  .cmd {
    display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 8px 10px;
    border-radius: var(--radius-control); background: var(--chrome); border: 1px solid var(--line);
    font: 12.5px/1.4 var(--mono); color: var(--ink); width: fit-content; max-width: 100%;
  }
  .cmd .p { color: var(--faint); }
  .foot { margin-top: 28px; color: var(--faint); font-size: 12.5px; }
  .unread {
    padding: 18px; border-radius: var(--radius-panel); background: var(--stopped-soft);
    border: 1px solid color-mix(in srgb, var(--stopped) 40%, var(--line-2));
  }
  .unread b {
    display: flex; gap: 8px; align-items: center; color: var(--stopped); margin-bottom: 6px;
  }
  .unread p { margin: 0; }
  @media (max-width: 760px) {
    .settings { grid-template-columns: 1fr; }
    .side {
      position: static; height: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
      border-right: 0; border-bottom: 1px solid var(--line); padding: 10px 12px;
    }
    .side h1 { margin: 0 8px 0 0; }
    .side .ver { margin: 0 0 0 auto; }
    .pane { padding: 16px; }
    .addform .cols { grid-template-columns: 1fr; }
    .shortcut { grid-template-columns: 1fr; gap: 4px; }
  }`;
}
