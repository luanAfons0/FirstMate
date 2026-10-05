/**
 * The Official Plugins: the Plugins the FirstMate project itself offers,
 * known here by name and address before they are fetched (ADR-0015).
 *
 * This is data and nothing else. It asks nothing of a Plugin and records
 * nothing about what a Plugin needs to run, because that would be a manifest
 * written by FirstMate on the Plugin's behalf (ADR-0002). A Plugin that cannot
 * run goes Stopped and says so on the Index Page.
 *
 * Adding one is one line here and a release.
 */

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
};

/** Every Official Plugin, in the order `setup` shows them. */
export const OFFICIAL_PLUGINS: readonly OfficialPlugin[] = [
  {
    name: 'worklog',
    url: 'https://github.com/luanAfons0/worklog',
    description: 'keeps what you work on from one Meeting to the next, and free Notes.',
    callsOthers: false,
  },
  {
    name: 'scheduler',
    url: 'https://github.com/luanAfons0/scheduler',
    description: 'calls one tool of another Plugin at a time you choose.',
    callsOthers: true,
  },
  {
    name: 'nexus',
    url: 'https://github.com/luanAfons0/nexus',
    description: 'manages the skills and global instructions of Claude and Codex.',
    callsOthers: false,
  },
];

/** The Official Plugin of this name, if there is one. */
export function officialPlugin(name: string): OfficialPlugin | undefined {
  return OFFICIAL_PLUGINS.find((plugin) => plugin.name === name);
}
