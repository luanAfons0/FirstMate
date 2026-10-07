/**
 * What a test asks a running Host about one Plugin, over HTTP, as the App and
 * a Plugin Page ask it: its state, and the answer to one tool call.
 *
 * It goes through `host.ts` and imports nothing of the Host, so the seam stays
 * the one a browser has.
 */
import type { Booted } from './host.ts';

/** The state the Host says one Plugin is in, as `/plugins.json` says it. */
export async function stateOf(host: Booted, name: string): Promise<string | undefined> {
  const { plugins } = (await (await host.fetch('/plugins.json')).json()) as {
    plugins: { name: string; state: string }[];
  };
  return plugins.find((plugin) => plugin.name === name)?.state;
}

/** What one tool call answered: its status, and the text of its first content. */
export type ToolAnswer = {
  readonly status: number;
  readonly text: string | undefined;
};

/**
 * Call one tool of a Plugin's Plugin Server, as its Plugin Page calls it: from
 * its own page, same-origin, over `/p/<name>/rpc`.
 */
export async function callTool(
  host: Booted,
  name: string,
  tool: string,
  args: Readonly<Record<string, unknown>> = {},
): Promise<ToolAnswer> {
  const answer = await host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${name}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const body = await answer.text();
  const said = (body.startsWith('{') ? JSON.parse(body) : {}) as {
    result?: { content?: { text?: string }[] };
  };
  return { status: answer.status, text: said.result?.content?.[0]?.text };
}
