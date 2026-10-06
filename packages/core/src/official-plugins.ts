/**
 * The Official Plugins: the Plugins the FirstMate project itself offers,
 * known here by name and address before they are fetched (ADR-0015).
 *
 * This is data and nothing else. It asks nothing of a Plugin. It says which
 * kinds of Place each one runs in, because `setup` offers a Place to install
 * it in and must not offer one where it would only go Stopped; that is a fact
 * FirstMate knows about its own Plugins, written here, and no manifest a
 * Plugin carries (ADR-0002, ADR-0024). Each Plugin moves to the `windows`
 * Place in a release of its own, and a 2.x minor then changes its line here.
 *
 * Adding one is one line here and a release.
 */

import type { PlaceKind } from './places.ts';

/** One Official Plugin, as FirstMate knows it before it is fetched. */
export type OfficialPlugin = {
  /** The Plugin Name it is installed under unless the operator gives another. */
  readonly name: string;
  /** Where it is cloned from. */
  readonly url: string;
  /** One line that says what it does. */
  readonly description: string;
  /**
   * Whether it calls the tools of other Plugins, and so needs a Grant to do
   * its job. `setup` offers Grants to these Plugins and to no others.
   */
  readonly callsOthers: boolean;
  /** The kinds of Place it runs in. `setup` offers only Places of these kinds. */
  readonly places: readonly PlaceKind[];
};

/** Every Official Plugin, in the order `setup` shows them. */
export const OFFICIAL_PLUGINS: readonly OfficialPlugin[] = [
  {
    name: 'worklog',
    url: 'https://github.com/luanAfons0/worklog',
    description: 'keeps what you work on from one Meeting to the next, and free Notes.',
    callsOthers: false,
    places: ['wsl'],
  },
  {
    name: 'scheduler',
    url: 'https://github.com/luanAfons0/scheduler',
    description: 'calls one tool of another Plugin at a time you choose.',
    callsOthers: true,
    places: ['wsl'],
  },
  {
    name: 'nexus',
    url: 'https://github.com/luanAfons0/nexus',
    description: 'manages the skills and global instructions of Claude and Codex.',
    callsOthers: false,
    places: ['wsl'],
  },
];

/** The Official Plugin of this name, if there is one. */
export function officialPlugin(name: string): OfficialPlugin | undefined {
  return OFFICIAL_PLUGINS.find((plugin) => plugin.name === name);
}
