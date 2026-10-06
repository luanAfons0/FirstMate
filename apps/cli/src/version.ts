/**
 * The version of this command line: the version of its package.
 *
 * `--version` says it, and `desktop` installs the App of the same version, so
 * one file reads it. The manifest is one folder up from `src/` in a clone and
 * from `dist/` in the package (ADR-0017).
 */
import { readFileSync } from 'node:fs';

/** Read the version from the package's own manifest, beside the bundle. */
export function ownVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) {
    throw new Error('the command line cannot read its own version from its package.json.');
  }
  return String(manifest.version);
}
