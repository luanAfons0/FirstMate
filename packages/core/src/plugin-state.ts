/**
 * What the Host says about a Plugin's Plugin Server, in the words of the Index
 * Page, the App and the command line alike.
 *
 * It lives here and not in the Host because the command line reads what the
 * running Host says over loopback and carries no Host of its own (ADR-0024).
 */

/** What the Host knows about a Plugin's Plugin Server. */
export type PluginState =
  /** The Plugin Server is up and has answered the handshake. */
  | 'running'
  /** The Plugin Server is no longer running, or never started. */
  | 'stopped'
  /** The Plugin ships no Plugin Server at all. */
  | 'no-plugin-server';

/** One Plugin, as `/plugins.json` lists it. */
export type PluginView = {
  /** The Plugin Name, which is also its address. */
  readonly name: string;
  /** Whether the Plugin ships a Plugin Page for the Host to link to. */
  readonly hasPage: boolean;
  /** What the Host knows about this Plugin's Plugin Server right now. */
  readonly state: PluginState;
};

/** What became of a Plugin the operator restarted. */
export type Restarted = {
  readonly state: PluginState;
  /** Why it is Stopped, when it is. */
  readonly why?: string;
};

/** The one word FirstMate says about a Plugin Server, wherever it says it. */
export const STATE_WORDS: Readonly<Record<PluginState, string>> = {
  running: 'Running',
  stopped: 'Stopped',
  'no-plugin-server': 'no Plugin Server',
};
