/**
 * The Tool Bus: the Host in its role of carrying a call from one Plugin to
 * another Plugin's tools.
 *
 * A Plugin Server asks over the pipe the Host already owns, not over loopback
 * HTTP (ADR-0009). The Host spawned that process and holds both ends, so the
 * calling Plugin Name comes from the connection and cannot be forged, and no
 * token and no port is ever handed to a Plugin.
 *
 * There is one rule: the target's Plugin Name must be in the calling Plugin's
 * Grants. There is no exception, not even for a Plugin calling itself.
 *
 * A caller may also say how long its call may take. Nobody is waiting on a
 * Tool Bus call the way a person waits on a Plugin Page, so work that takes
 * minutes is honest work here and thirty seconds is the wrong answer for it.
 * The Host keeps a ceiling all the same, so that one wedged Plugin cannot hold
 * a call open for ever.
 */
import {
  CALL_TIMEOUT_MS,
  HOST_ERROR,
  noSuchMethod,
  type Answer,
  type Answering,
  type JsonRpcMessage,
  type PluginServer,
} from './mcp.ts';
import type { PluginRow } from './registry.ts';
import type { PluginState } from './supervisor.ts';

/** The method a Plugin Server calls another Plugin's tool with. */
export const CALL_TOOL = 'firstmate/tools/call';

/** The method a Plugin Server lists another Plugin's tools with. */
export const LIST_TOOLS = 'firstmate/tools/list';

/**
 * How many Plugins one call may pass through. Two Plugins granted to each
 * other can call each other without end, so the Host counts and fails loudly
 * rather than spin. Nothing honest goes this deep.
 */
export const CHAIN_LIMIT = 8;

/** Where a call can go: the Plugin Servers the Supervisor is holding. */
export type Reach = {
  stateOf(name: string): PluginState;
  serverOf(name: string): PluginServer | null;
};

export type ToolBus = {
  /** What the Host answers the Plugin Server of this one Plugin. */
  answering(from: string): Answering;
};

/**
 * Open the Tool Bus over a Registry and the Plugin Servers behind it.
 *
 * The Grants are read once, because the Registry is read once: a Grant that
 * changes is a Grant the operator restarts the Host for, which is what the
 * `grant` and `revoke` commands say. A target is resolved when the call
 * arrives and never here, so a Plugin that is Stopped later says Stopped.
 *
 * The ceiling is read once for the same reason: it comes from the environment
 * the Host was started in, and `FIRSTMATE_MAX_CALL_MS` moves it.
 */
export function openToolBus(
  plugins: readonly PluginRow[],
  reach: Reach,
  maxCallMs: number,
): ToolBus {
  const registered = new Set(plugins.map((plugin) => plugin.name));
  const grants = new Map(plugins.map((plugin) => [plugin.name, new Set(plugin.grants)]));
  // The chains of Plugin Names the Host is carrying into each Plugin now.
  const carrying = new Map<string, string[][]>();

  return {
    answering: (from) => (method, params) =>
      carry({ registered, grants, carrying, reach, maxCallMs }, from, method, params),
  };
}

type Bus = {
  readonly registered: ReadonlySet<string>;
  readonly grants: ReadonlyMap<string, ReadonlySet<string>>;
  readonly carrying: Map<string, string[][]>;
  readonly reach: Reach;
  readonly maxCallMs: number;
};

async function carry(bus: Bus, from: string, method: string, params: unknown): Promise<Answer> {
  if (method !== CALL_TOOL && method !== LIST_TOOLS) return noSuchMethod(method);

  const asked = (params ?? {}) as Record<string, unknown>;
  const to = asked['plugin'];
  if (typeof to !== 'string') {
    return refuse(`A ${method} needs a "plugin" naming the Plugin to reach.`);
  }

  const wanted = asked['timeoutMs'];
  if (wanted !== undefined && !isWholeMilliseconds(wanted)) {
    return refuse(
      `The "timeoutMs" of a ${method} must be a whole number of milliseconds above zero, ` +
        `not ${JSON.stringify(wanted)}.`,
    );
  }

  // The Grant is checked before anything else is looked up, so that a Plugin
  // the operator did not trust learns nothing about the rest of the Registry.
  if (bus.grants.get(from)?.has(to) !== true) {
    return refuse(`The Plugin named ${from} holds no Grant to call the Plugin named ${to}.`);
  }

  const chain = [...inherited(bus.carrying, from), to];
  if (chain.length > CHAIN_LIMIT) {
    return refuse(
      `A call may pass through ${CHAIN_LIMIT} Plugins. ` +
        `This one has already passed through ${chain.join(', ')}.`,
    );
  }

  if (!bus.registered.has(to)) return refuse(`No Plugin named ${to} is in the Registry.`);
  if (bus.reach.stateOf(to) === 'no-plugin-server') {
    return refuse(`The Plugin named ${to} ships no Plugin Server.`);
  }
  const server = bus.reach.serverOf(to);
  if (server === null) return refuse(`The Plugin named ${to} is Stopped.`);

  const onward: JsonRpcMessage = {
    jsonrpc: '2.0',
    method: method === CALL_TOOL ? 'tools/call' : 'tools/list',
    // "plugin" and "timeoutMs" are addressed to the Host and to nobody else,
    // so the target Plugin's tool is never handed a field it did not ask for.
    params: without(asked, 'plugin', 'timeoutMs'),
  };

  // What the caller asked for, under the Host's ceiling. Over the ceiling is
  // quietly given the ceiling rather than refused: a Plugin should not have to
  // know the Host's number to be allowed to run. Asking for nothing is the
  // thirty seconds every call had before there was anything to ask with.
  const waitMs = Math.min(wanted ?? CALL_TIMEOUT_MS, bus.maxCallMs);

  hold(bus.carrying, to, chain);
  try {
    const answered = await server.call(onward, waitMs);
    // The target Plugin's own answer, and nothing of the Host's around it.
    return 'error' in answered ? { error: answered['error'] } : { result: answered['result'] };
  } catch (cause) {
    return refuse(cause instanceof Error ? cause.message : String(cause));
  } finally {
    release(bus.carrying, to, chain);
  }
}

/**
 * The chain a question from this Plugin belongs to.
 *
 * A Plugin Server does not say which of the calls the Host is carrying into it
 * a question came out of, and asking it to would put a name the Plugin could
 * forge, or a secret, into a Plugin's hands. So the Host takes the longest
 * chain it is carrying into that Plugin. That over-counts a Plugin serving two
 * calls at once and can never under-count, which is the safe way round for a
 * cap whose whole job is to stop a cycle.
 */
function inherited(carrying: ReadonlyMap<string, string[][]>, from: string): readonly string[] {
  let longest: readonly string[] = [from];
  for (const chain of carrying.get(from) ?? []) {
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}

function hold(carrying: Map<string, string[][]>, to: string, chain: string[]): void {
  const held = carrying.get(to);
  if (held === undefined) carrying.set(to, [chain]);
  else held.push(chain);
}

/**
 * The Host keeps nothing about a call that is over (ADR-0005), so the last
 * chain out of a Plugin takes the Plugin's entry with it.
 */
function release(carrying: Map<string, string[][]>, to: string, chain: string[]): void {
  const held = carrying.get(to);
  if (held === undefined) return;
  const where = held.indexOf(chain);
  if (where >= 0) held.splice(where, 1);
  if (held.length === 0) carrying.delete(to);
}

function without(
  params: Record<string, unknown>,
  ...keys: readonly string[]
): Record<string, unknown> {
  const rest = { ...params };
  for (const key of keys) delete rest[key];
  return rest;
}

/** A "timeoutMs" is a whole number of milliseconds above zero, or it is nothing. */
function isWholeMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Every refusal is a sentence the Plugin author can act on. */
function refuse(why: string): Answer {
  return { error: { code: HOST_ERROR, message: why } };
}
