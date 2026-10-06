/**
 * Each Plugin as the Host holds it: its Registry row, the path this machine
 * reads its files through, and how its Plugin Server starts.
 *
 * Both come from the Plugin's Place. A local Plugin's files are where its
 * directory is, and its Plugin Server is a process of the Host's own. A `wsl`
 * Plugin's files are read through its Place's root, and its Plugin Server
 * runs inside the distribution through `wsl.exe` (ADR-0021).
 */
import { allPlaces, filesOf } from './places.ts';
import { readRegistry, type PluginRow } from './registry.ts';
import { readSettings } from './settings.ts';

/** How a Plugin's Plugin Server starts. */
type Runner =
  /** On this machine, from the file the platform runs (ADR-0019). */
  | { readonly kind: 'local' }
  /** Inside a WSL distribution, from the `mcp` file as it is. */
  | { readonly kind: 'wsl'; readonly distribution: string }
  /** Nowhere: the Place the Plugin names is not there, and this says so. */
  | { readonly kind: 'nowhere'; readonly why: string };

/** A Plugin as the Host holds it. */
export type HeldPlugin = PluginRow & {
  /** The path this machine reads the Plugin's directory through. */
  readonly files: string;
  readonly runner: Runner;
};

/** Every Plugin in the Registry, each with its Place worked out. */
export function readPlugins(home: string): HeldPlugin[] {
  const places = allPlaces(readSettings(home).places);
  return readRegistry(home).map((row): HeldPlugin => {
    const place = places.find((one) => one.name === row.place);
    if (place === undefined) {
      const why = `its Place, ${row.place}, is not there. Add it, or move the Plugin`;
      return { ...row, files: row.directory, runner: { kind: 'nowhere', why } };
    }
    const runner: Runner =
      place.kind === 'wsl' ? { kind: 'wsl', distribution: place.distribution } : { kind: 'local' };
    return { ...row, files: filesOf(place, row.directory), runner };
  });
}
