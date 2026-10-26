/**
 * The Process View: one table of what FirstMate and each Plugin Server use
 * now, FirstMate's own row first, then every Plugin in the Plugin Order
 * (ADR-0032).
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can read what it shows (ADR-0008). The main process reads
 * `/processes.json` every 2 seconds while the view is shown (`processes.ts`)
 * and writes each reading in here whole; the page runs no script of its own.
 *
 * The columns have fixed widths, so nothing moves when a row changes state or
 * a reading arrives. Each CPU and memory figure has a 2px bar to its left, on
 * one scale for its whole column, with no track: the largest figure fills its
 * slot. With fewer than two measured rows there is nothing to compare, so no
 * bar shows. A row with no figures says why across the figure columns, and a
 * Stopped row puts Restart right after its reason. Until the first reading
 * arrives, the cells hold their place. A Place column shows only when the
 * rows are in more than one Place. A narrow window drops the PID and the
 * process count first, then the uptime and the Place, then "the App".
 *
 * Every row carries `data-key`, every meter its column and every figure its
 * value, so a sort and a glide to each new reading can be added over this
 * markup (#234).
 */
import { STATE_WORDS } from '@firstmate/core/plugin-state';
import { type IconName, icon } from '@firstmate/core/theme';
import {
  cpuText,
  FIRSTMATE_ROW,
  memoryText,
  uptimeText,
  type UsageRow,
} from '@firstmate/core/usage';
import { restartAsk } from './ask.ts';
import type { Plugins, Usage } from './host-lists.ts';
import { escaped, written, type Written } from './pages.ts';

/** How often the view reads Usage again while it is shown, in milliseconds. */
export const EVERY_MS = 2_000;

/** What the Process View shows. */
export type ProcessesShown = {
  /** The last reading, or `first` while the first one is on its way. */
  readonly usage: Usage | { readonly kind: 'first' };
  /** Every Plugin the Host last named, which the first reading's rows are drawn from. */
  readonly plugins: Plugins;
  /** The Plugins whose restart was asked for and has not answered yet. */
  readonly restarting: readonly string[];
  /** The time of the drawing, which each uptime is counted to. */
  readonly now: number;
};

/** The icons any body of the Process View may draw. */
const ICONS: readonly IconName[] = ['anchor', 'warning-circle', 'arrow-clockwise', 'circle-notch'];

/** A figure column: its key on a meter, the header's words, and how a figure is said. */
type Column = {
  readonly key: 'cpu' | 'memory';
  readonly words: string;
  readonly figure: (row: UsageRow) => number | null;
  readonly text: (value: number) => string;
};

const CPU: Column = { key: 'cpu', words: 'CPU', figure: (row) => row.cpuPercent, text: cpuText };
const MEMORY: Column = {
  key: 'memory',
  words: 'Memory',
  figure: (row) => row.memoryBytes,
  text: memoryText,
};

/** The shortest bar, so a figure of almost nothing still shows one. */
const LEAST_BAR = 0.015;

/** The Process View. */
export function processesPage(shown: ProcessesShown): Written {
  const every = `<span class="every" title="The view reads Usage again while it is shown">\
every ${EVERY_MS / 1000} s</span>`;
  const head = (counted: string): string =>
    `<div class="pv-head"><h1>Processes</h1><span class="count">${counted}</span>\
<span class="grow"></span>${every}</div>`;
  let body: string;
  if (shown.usage.kind === 'untold') {
    body = `${head('')}<div class="pv-scroll"><div class="unsaid" role="status">\
<p class="lead">${icon('warning-circle')}The Host would not say what each Plugin uses.</p>\
<p class="how">The view asks again in ${EVERY_MS / 1000} s. If it keeps failing, \
<code>firstmate logs</code> shows why.</p></div></div>`;
  } else {
    const rows = shown.usage.kind === 'told' ? toldRows(shown) : firstRows(shown.plugins);
    const empty =
      shown.usage.kind === 'told' && shown.usage.processes.plugins.length === 0
        ? `<div class="empty"><p class="lead">No Plugin is registered yet.</p>\
<p class="how">Add one with <code>firstmate install &lt;dir|url|name&gt;</code>, \
and it shows here with what it uses.</p></div>`
        : '';
    body = `${head(counted(rows.count))}<div class="pv-scroll">\
<table class="pt" aria-label="Usage of FirstMate and each Plugin">\
<thead>${headRow(rows.withPlace)}</thead><tbody>${rows.html}</tbody></table>${empty}</div>`;
  }
  return written('Processes', styles(), `<div class="view">${body}</div>`, '', ICONS);
}

/** The rows of a table, how many Plugins they hold, and whether they show a Place. */
type Rows = { readonly html: string; readonly count: number; readonly withPlace: boolean };

function counted(count: number): string {
  if (count === 0) return 'No Plugins';
  return `${count} Plugin${count === 1 ? '' : 's'}`;
}

function headRow(withPlace: boolean): string {
  const place = withPlace ? '<th class="c-place w-place" scope="col">Place</th>' : '';
  const figure = (column: Column): string =>
    `<th class="num u w-u" scope="col" data-key="${column.key}">${column.words}</th>`;
  return `<tr><th scope="col">Plugin</th>${place}${figure(CPU)}${figure(MEMORY)}\
<th class="num c-up w-up" scope="col">Uptime</th><th class="num c-pid w-pid" scope="col">PID</th>\
<th class="num c-procs w-procs" scope="col">Procs</th></tr>`;
}

/** Whether a row was measured: its Plugin Server runs, and every figure is there. */
function measured(row: UsageRow): boolean {
  return (
    row.state === 'running' &&
    row.unmeasured === undefined &&
    row.cpuPercent !== null &&
    row.memoryBytes !== null
  );
}

/** The bars of one column: the largest figure among the measured rows, and how many there are. */
type Scale = { readonly most: number; readonly measured: number };

function scaleOf(rows: readonly UsageRow[], column: Column): Scale {
  const figures = rows.filter(measured).map((row) => column.figure(row) ?? 0);
  return { most: Math.max(...figures, 0), measured: figures.length };
}

/** The rows of a reading. */
function toldRows(shown: ProcessesShown): Rows {
  if (shown.usage.kind !== 'told') return { html: '', count: 0, withPlace: false };
  const { firstmate, plugins } = shown.usage.processes;
  const all = [firstmate, ...plugins];
  const withPlace = new Set(all.map((row) => row.place)).size > 1;
  const scales = { cpu: scaleOf(all, CPU), memory: scaleOf(all, MEMORY) };
  const html = all
    .map((row) => {
      const own = row === firstmate;
      const place = withPlace ? `<td class="place c-place">${escaped(row.place)}</td>` : '';
      return `<tr${own ? ' class="self"' : ''} data-key="${escaped(row.name)}">\
<td>${who(own ? undefined : row)}</td>${place}${cells(row, scales, shown)}</tr>`;
    })
    .join('');
  return { html, count: plugins.length, withPlace };
}

/**
 * The rows before the first reading: FirstMate's and every Plugin the Host
 * named, each in its state, with cells that hold the place of the figures.
 */
function firstRows(plugins: Plugins): Rows {
  const named = plugins.kind === 'told' ? plugins.plugins : [];
  const own = `<tr class="self" data-key="${FIRSTMATE_ROW}"><td>${who(undefined)}</td>\
${SKELETON}</tr>`;
  const html = named
    .map((plugin) => {
      const said =
        plugin.state === 'no-plugin-server'
          ? gapCells(`<span class="gap none">${STATE_WORDS['no-plugin-server']}</span>`)
          : SKELETON;
      return `<tr data-key="${escaped(plugin.name)}"><td>${who(plugin)}</td>${said}</tr>`;
    })
    .join('');
  return { html: own + html, count: named.length, withPlace: false };
}

/** The cells of a row whose figures are on their way: they hold their place. */
const SKELETON = `<td class="num u"><div class="meter"><span></span><span class="sk"></span>\
</div></td><td class="num u"><div class="meter"><span></span><span class="sk"></span></div></td>\
<td class="num c-up"><span class="sk short"></span></td>\
<td class="num c-pid"><span class="sk short"></span></td>\
<td class="num c-procs"><span class="sk short"></span></td>`;

/** The first cell: FirstMate's mark and name, or a Plugin's state shape and name. */
function who(plugin: { readonly name: string; readonly state: string } | undefined): string {
  if (plugin === undefined) {
    return `<div class="who">${icon('anchor', 'mark')}<b>${FIRSTMATE_ROW}</b>\
<small>the App</small></div>`;
  }
  return `<div class="who"><span class="dot ${plugin.state}" aria-hidden="true"></span>\
<b>${escaped(plugin.name)}</b></div>`;
}

/** The cells after the first, and after the Place. */
function cells(
  row: UsageRow,
  scales: Readonly<Record<Column['key'], Scale>>,
  shown: ProcessesShown,
): string {
  if (row.state === 'stopped') return gapCells(stoppedGap(row, shown.restarting));
  if (row.state === 'no-plugin-server') {
    return gapCells(`<span class="gap none">${STATE_WORDS['no-plugin-server']}</span>`);
  }
  if (row.unmeasured !== undefined) {
    const said = escaped(`not measured: ${row.unmeasured}`);
    return gapCells(`<span class="gap unread" title="${said}">${icon('warning-circle')}\
<span class="why">${said}</span></span>`);
  }
  if (!measured(row)) return SKELETON;
  const uptime = row.startedAt === null ? '' : uptimeText(row.startedAt, shown.now);
  return `<td class="num u">${meter(row, CPU, scales.cpu)}</td>\
<td class="num u">${meter(row, MEMORY, scales.memory)}</td>\
<td class="num c-up mono up">${uptime}</td>\
<td class="num c-pid mono pid">${row.pid ?? ''}</td>\
<td class="num c-procs mono procs">${row.processes ?? ''}</td>`;
}

/**
 * One figure and its bar. The bar's length is the figure against the largest
 * in its column; the largest figure is set stronger, when there is another
 * to compare it with.
 */
function meter(row: UsageRow, column: Column, scale: Scale): string {
  const value = column.figure(row) ?? 0;
  const share = scale.most > 0 ? Math.max(value / scale.most, LEAST_BAR) : LEAST_BAR;
  const top = value === scale.most && scale.measured > 1 ? ' data-top' : '';
  const solo = scale.measured < 2 ? ' data-solo' : '';
  return `<div class="meter" data-key="${column.key}"${top}${solo} \
style="--f: ${share.toFixed(4)}"><span class="bar"></span>\
<span class="v" data-v="${value}">${column.text(value)}</span></div>`;
}

/**
 * Why a Plugin is Stopped, and Restart right after it, as the switcher has
 * it. The Supervisor says why as a sentence; its last full stop is dropped,
 * because the reason is shown as code.
 */
function stoppedGap(row: UsageRow, restarting: readonly string[]): string {
  const why = (row.why ?? '').replace(/\.$/, '');
  const busy = restarting.includes(row.name);
  const again = `<button class="again" type="button" data-ask="${escaped(restartAsk(row.name))}"\
${busy ? ' aria-disabled="true" aria-busy="true"' : ''} title="Start its Plugin Server again">\
${icon(busy ? 'circle-notch' : 'arrow-clockwise')}${busy ? 'Starting' : 'Restart'}</button>`;
  const reason = why === '' ? '' : `<code title="${escaped(why)}">${escaped(why)}</code>`;
  return `<span class="gap"><span class="st">${STATE_WORDS.stopped}</span>${reason}${again}</span>`;
}

/**
 * A row with no figures says why in the CPU cell, which runs over the empty
 * cells after it, so every row keeps the same columns and a hidden column
 * hides everywhere.
 */
function gapCells(content: string): string {
  return `<td class="gapcell">${content}</td><td></td><td class="c-up"></td>\
<td class="c-pid"></td><td class="c-procs"></td>`;
}

function styles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: var(--bg); }
  body { color: var(--text); font: 13px/1.45 var(--sans); -webkit-font-smoothing: antialiased; }
  ::selection { background: var(--accent-soft); color: var(--ink); }
  button { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  code { font-family: var(--mono); font-size: .92em; color: var(--ink); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb {
    background: var(--line-2); border-radius: 10px; border: 3px solid var(--bg);
  }
  ::-webkit-scrollbar-track { background: transparent; }

  .view { height: 100vh; display: flex; flex-direction: column; }
  .pv-head {
    flex: none; display: flex; align-items: center; gap: 10px; height: 44px;
    padding: 0 16px 0 20px; min-width: 0;
  }
  .pv-head h1 {
    margin: 0; font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: nowrap;
  }
  .pv-head .count { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
  .pv-head .grow { flex: 1; }
  .pv-head .every { color: var(--faint); font: 11.5px var(--mono); white-space: nowrap; }

  .pv-scroll { flex: 1; min-height: 0; overflow: auto; container-type: inline-size; }
  /* Fixed column widths, so a column never moves when a row changes state or a
     reading arrives. The Plugin column takes what is left. */
  table.pt {
    width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .pt th {
    position: sticky; top: 0; z-index: 1; height: 32px; padding: 0 12px;
    background: var(--chrome); border-block: 1px solid var(--line);
    font: 600 11px/1 var(--sans); letter-spacing: .07em; text-transform: uppercase;
    color: var(--muted); text-align: left; white-space: nowrap;
  }
  .pt th.num, .pt td.num { text-align: right; }
  .pt .w-place { width: 112px; }
  .pt .w-u { width: 216px; }
  .pt .w-up { width: 120px; }
  .pt .w-pid { width: 80px; }
  .pt .w-procs { width: 80px; }
  .pt th:first-child, .pt td:first-child { padding-left: 20px; }
  .pt th:last-child, .pt td:last-child { padding-right: 16px; }

  .pt td {
    height: 31px; padding: 0 12px; border-bottom: 1px solid var(--line); white-space: nowrap;
    transition: background-color .15s ease-out;
  }
  .pt tbody tr:last-child td { border-bottom: 0; }
  @media (hover: hover) and (pointer: fine) {
    .pt tbody tr:hover td { background: var(--row-hover); }
  }
  .who { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .who b {
    font: 500 12.5px/1 var(--mono); color: var(--ink); overflow: hidden; text-overflow: ellipsis;
  }
  .place { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }

  /* FirstMate's own row: the App's main process, its GPU process and its own
     views. It reads as the line above the Plugins, as a total row reads below
     a table. */
  tr.self td { background: var(--raised); border-bottom-color: var(--line-2); }
  @media (hover: hover) and (pointer: fine) {
    tr.self:hover td { background: var(--raised); }
  }
  tr.self .who b { font: 600 13px/1 var(--sans); }
  tr.self .who .mark { width: 14px; height: 14px; color: var(--brand); margin: 0 -3px; }
  /* In a narrow column the name stays whole, and "the App" gives way first. */
  tr.self .who b { flex: none; }
  tr.self .who small {
    color: var(--faint); font-size: 11.5px; font-weight: 400; min-width: 0;
    overflow: hidden; text-overflow: ellipsis;
  }

  /* Usage: a figure, and a 2px bar beside it, on one scale for the whole
     column. No track: the length is the reading, the empty space is the room
     left. */
  .meter {
    display: grid; grid-template-columns: 88px 6.5ch; align-items: center; gap: 10px;
    width: max-content; margin-left: auto;
  }
  .pt td.u, .pt th.u { padding-left: 28px; }
  .bar {
    height: 2px; border-radius: 1px; background: var(--accent);
    transform-origin: left center; transform: scaleX(var(--f, 0));
  }
  /* With one row there is nothing to compare, so no bar. */
  .meter[data-solo] .bar { visibility: hidden; }
  .v { font: 12px/1 var(--mono); color: var(--text); text-align: right; }
  .meter[data-top] .v { color: var(--ink); font-weight: 600; }
  .mono { font: 12px/1 var(--mono); }
  .up { color: var(--text); }
  .pid { color: var(--faint); }
  .procs { color: var(--muted); }

  /* A row with no figures says why in the CPU cell and runs over the empty
     cells after it. */
  .pt { --span-w: 712px; }
  .pt td.gapcell { overflow: visible; text-align: left; position: relative; z-index: 0; }
  .gapcell .gap { width: calc(var(--span-w) - 24px); }
  .gap {
    display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--muted);
    font-size: 12px;
  }
  .gap .st { color: var(--stopped); font-weight: 600; flex: none; }
  .gap code {
    color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis;
  }
  .gap .again { margin-left: 6px; flex: none; }
  .gap.none { color: var(--faint); }
  .gap.unread svg.i { width: 14px; height: 14px; color: var(--muted); }
  .gap .why { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .again {
    display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px;
    border: 1px solid var(--line-2); border-radius: var(--radius-control); background: var(--bg);
    cursor: pointer; font-size: 11.5px; color: var(--text);
    transition: transform .12s ease-out;
  }
  .again:hover { border-color: var(--faint); color: var(--ink); }
  .again:active { transform: scale(.97); }
  .again[aria-busy='true'] { cursor: default; color: var(--muted); }
  .again svg.i { width: 12px; height: 12px; }
  .again[aria-busy='true'] svg.i { animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* The cells of a row whose first reading has not arrived hold its place. */
  .sk {
    display: inline-block; height: 8px; width: 40px; border-radius: 999px;
    background: var(--hover); vertical-align: middle;
  }
  .sk.short { width: 28px; }
  .meter .sk { justify-self: end; }

  .empty, .unsaid { padding: 28px 20px; display: grid; gap: 4px; max-width: 62ch; }
  .empty p, .unsaid p { margin: 0; }
  .empty .lead { color: var(--ink); font-weight: 600; }
  .unsaid .lead {
    display: inline-flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 600;
  }
  .unsaid .lead svg.i { color: var(--stopped); }
  .empty .how, .unsaid .how { color: var(--muted); }

  /* Narrow windows keep the Usage and drop the detail, widest first. */
  @container (max-width: 700px) {
    .c-pid, .c-procs { display: none; }
    .pt { --span-w: 552px; }
  }
  @container (max-width: 520px) {
    .c-up, .c-place, tr.self .who small { display: none; }
    .pt { --span-w: 216px; }
    .meter { grid-template-columns: 16px 6.5ch; gap: 6px; }
    .pt .w-u { width: 108px; }
    .pt th, .pt td, .pt td.u, .pt th.u { padding: 0 8px; }
    .pt th:first-child, .pt td:first-child { padding-left: 14px; }
  }
  @media (max-width: 560px) { .pv-head .count { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    .again, .pt td { transition: none; }
    .again[aria-busy='true'] svg.i { animation: none; }
  }`;
}
