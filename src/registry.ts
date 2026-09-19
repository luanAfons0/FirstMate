/**
 * The Registry: the Host's record of which Plugins exist and where their
 * directories are.
 *
 * It is one file in the Host's home directory. There is no scanning and no
 * plugins folder: a Plugin is registered or it does not exist.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** The Registry file, inside the Host's home directory. */
export const REGISTRY_FILE = 'registry.json';

/**
 * A Plugin Name identifies the Plugin in every address, so it holds only what
 * is safe and readable in a URL path.
 */
const PLUGIN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PluginRow = {
  /** The name the Plugin is given when it enters the Registry. */
  readonly name: string;
  /** The absolute path of the Plugin's directory. It is never copied. */
  readonly directory: string;
  /**
   * The Plugin Names this Plugin may call the tools of. The Tool Bus carries a
   * call only when the target is named here (ADR-0009).
   */
  readonly grants: readonly string[];
};

export function registryPath(home: string): string {
  return join(home, REGISTRY_FILE);
}

export function isPluginName(name: string): boolean {
  return PLUGIN_NAME.test(name);
}

/**
 * Every row of the Registry. A Registry that is not there yet holds no
 * Plugins; a Registry that cannot be read is an error the operator must see.
 */
export function readRegistry(home: string): PluginRow[] {
  const path = registryPath(home);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read the Registry at ${path}.`, { cause });
  }
  return parseRegistry(text, path);
}

/**
 * Replace the Registry with these rows. It is written whole and moved into
 * place, so a Host reading it always sees one Registry or the one before it.
 */
export function writeRegistry(home: string, rows: readonly PluginRow[]): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = registryPath(home);
  const pending = `${path}.pending`;
  const plugins = rows.map((row) => ({
    name: row.name,
    directory: row.directory,
    // A Grant is the operator's to give and to take back, so it is kept
    // untouched through every add and every remove.
    grants: [...row.grants],
  }));
  writeFileSync(pending, `${JSON.stringify({ plugins }, null, 2)}\n`, { mode: 0o600 });
  renameSync(pending, path);
}

function parseRegistry(text: string, path: string): PluginRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`The Registry at ${path} is not valid JSON.`, { cause });
  }
  const rows = (parsed as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(rows)) {
    throw new Error(`The Registry at ${path} needs a "plugins" array.`);
  }
  return rows.map((row, index) => parseRow(row, index, path));
}

function parseRow(row: unknown, index: number, path: string): PluginRow {
  const where = `Plugin ${index + 1} in the Registry at ${path}`;
  const record = row as Record<string, unknown> | null;
  const name = record?.['name'];
  const directory = record?.['directory'];
  const grants = record?.['grants'] ?? [];
  if (typeof name !== 'string' || !isPluginName(name)) {
    throw new Error(
      `${where} needs a Plugin Name of lower-case letters, digits and hyphens.`,
    );
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error(`${where} needs an absolute directory path.`);
  }
  if (!Array.isArray(grants) || grants.some((grant) => typeof grant !== 'string')) {
    throw new Error(`${where} needs its Grants as an array of Plugin Names.`);
  }
  return { name, directory, grants: grants as string[] };
}
