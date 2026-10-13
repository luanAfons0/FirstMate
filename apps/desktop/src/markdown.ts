/**
 * The small part of Markdown the Mate panel shows an answer in: paragraphs,
 * headings, lists, quotes, rules, code blocks, inline code, emphasis and
 * links.
 *
 * It is written here, and no library is taken for it (ADR-0031): it is about
 * two hundred lines, and an answer is text the Agent wrote, which may hold
 * anything a web page it read held. The panel carries the App's preload, so
 * whatever this writes runs with the right to ask the main process for
 * things. So the rule is simple: every character of the answer is escaped,
 * and the only markup is the fixed tags this file writes. No attribute takes
 * the answer's text but a link's ask, which is encoded and then escaped, and
 * an ordered list's start, which is digits. A link opens nothing in the
 * panel: its click asks the main process, which gives an `http`, `https` or
 * `mailto` address to the operator's browser and refuses any other.
 *
 * An answer arrives in parts, so a half-written answer must render too: a
 * code block with no closing fence runs to the end, and an unclosed `**` is
 * text.
 */
import { icon } from '@firstmate/core/theme';
import { mateLinkAsk } from './ask.ts';
import { escaped } from './pages.ts';

/** How deep quotes and lists nest before the rest is shown as plain text. */
const DEEPEST = 6;

/** The schemes a link may open in the operator's browser. Any other is text. */
const LINKED = /^(https?:\/\/|mailto:)/i;

/** An answer, as the HTML the panel shows. */
export function markdown(text: string): string {
  return blocks(text.replace(/\r\n?/g, '\n').split('\n'), 0);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

/** Lines of Markdown as blocks, `depth` quotes or lists deep. */
function blocks(lines: readonly string[], depth: number): string {
  let html = '';
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? '';
    if (line.trim() === '') {
      at += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1] ?? '```';
      const code: string[] = [];
      at += 1;
      while (at < lines.length && !(lines[at] ?? '').trimStart().startsWith(mark)) {
        code.push(lines[at] ?? '');
        at += 1;
      }
      at += 1;
      html += `<pre><code>${escaped(code.join('\n'))}</code></pre>`;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const tag = (heading[1] ?? '').length <= 3 ? 'h3' : 'h4';
      html += `<${tag}>${inline(heading[2] ?? '')}</${tag}>`;
      at += 1;
      continue;
    }
    if (RULE.test(line)) {
      html += '<hr>';
      at += 1;
      continue;
    }
    if (depth < DEEPEST && QUOTE.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at] ?? '')) {
        quoted.push(QUOTE.exec(lines[at] ?? '')?.[1] ?? '');
        at += 1;
      }
      html += `<blockquote>${blocks(quoted, depth + 1)}</blockquote>`;
      continue;
    }
    if (depth < DEEPEST && ITEM.test(line)) {
      const listed = list(lines, at, depth);
      html += listed.html;
      at = listed.next;
      continue;
    }
    // The first line is taken whatever it starts, so a quote or a list too
    // deep to nest is text, and the loop always moves on.
    const paragraph: string[] = [line.trim()];
    at += 1;
    while (at < lines.length && !startsABlock(lines[at] ?? '')) {
      paragraph.push((lines[at] ?? '').trim());
      at += 1;
    }
    html += `<p>${paragraph.map(inline).join('<br>')}</p>`;
  }
  return html;
}

/** Whether a line ends the paragraph before it. */
function startsABlock(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line)
  );
}

/**
 * One list, from its first item: every item of the same kind that follows,
 * each with the lines indented under it, which are its own blocks.
 */
function list(
  lines: readonly string[],
  from: number,
  depth: number,
): { readonly html: string; readonly next: number } {
  const first = ITEM.exec(lines[from] ?? '');
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: string[] = [];
  let at = from;
  while (at < lines.length) {
    const item = ITEM.exec(lines[at] ?? '');
    if (item === null || /\d/.test(item[2] ?? '') !== ordered) break;
    const under: string[] = [];
    at += 1;
    // An item holds the lines indented under it, and a blank line between them.
    while (at < lines.length) {
      const next = lines[at] ?? '';
      if (/^\s{2,}\S/.test(next)) under.push(next.replace(/^\s{2,4}/, ''));
      else if (next.trim() === '' && /^\s{2,}\S/.test(lines[at + 1] ?? '')) under.push('');
      else break;
      at += 1;
    }
    const nested = under.length === 0 ? '' : blocks(under, depth + 1);
    items.push(`<li>${inline(item[3] ?? '')}${nested}</li>`);
    // A blank line between two items of one list keeps it one list.
    if ((lines[at] ?? '').trim() === '' && ITEM.test(lines[at + 1] ?? '')) at += 1;
  }
  const start = ordered ? Number.parseInt(first?.[2] ?? '1', 10) : 1;
  const open = ordered ? (start === 1 ? '<ol>' : `<ol start="${start}">`) : '<ul>';
  return { html: `${open}${items.join('')}${ordered ? '</ol>' : '</ul>'}`, next: at };
}

/**
 * What one line may hold: inline code, which shows its text as it is; a link,
 * whose text may hold emphasis; a bare web address; strong and emphasised
 * text. Whatever matches none of them is text, escaped.
 */
const INLINE = new RegExp(
  [
    /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source,
    /\[([^\]\n]+)\]\(<?([^()\s<>]+)>?\)/.source,
    /<((?:https?:\/\/|mailto:)[^\s<>]+)>/.source,
    /\*\*(?=\S)([\s\S]*?\S)\*\*/.source,
    /__(?=\S)([\s\S]*?\S)__(?!\w)/.source,
    /\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*/.source,
    /(?<!\w)_(?=[^\s_])([^_]*?[^\s_]|[^\s_])_(?!\w)/.source,
    /(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_\]])/.source,
  ].join('|'),
  'g',
);

/** One line of an answer, as HTML. */
function inline(text: string): string {
  let html = '';
  let at = 0;
  for (const found of text.matchAll(INLINE)) {
    html += escaped(text.slice(at, found.index));
    at = found.index + found[0].length;
    const [, , code, label, href, angled, strong, strongToo, em, emToo, bare] = found;
    if (code !== undefined) html += `<code>${escaped(code)}</code>`;
    else if (label !== undefined) html += link(href ?? '', inline(label));
    else if (angled !== undefined) html += link(angled, escaped(angled));
    else if (strong !== undefined || strongToo !== undefined) {
      html += `<strong>${inline(strong ?? strongToo ?? '')}</strong>`;
    } else if (em !== undefined || emToo !== undefined) {
      html += `<em>${inline(em ?? emToo ?? '')}</em>`;
    } else if (bare !== undefined) html += link(bare, escaped(bare));
  }
  return html + escaped(text.slice(at));
}

/**
 * A link: a click asks the main process to open its address in the
 * operator's browser. An address of any other scheme is shown as text.
 */
function link(address: string, label: string): string {
  if (!LINKED.test(address)) return label;
  return (
    `<a href="#" data-ask="${escaped(mateLinkAsk(address))}" title="${escaped(address)}">` +
    `${label}${icon('arrow-square-out')}</a>`
  );
}
