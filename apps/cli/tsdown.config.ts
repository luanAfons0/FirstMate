/**
 * The only build in this project, and it runs on the publish path alone.
 *
 * Node refuses to strip types under node_modules, so a published FirstMate has
 * to be JavaScript, and `core` and `host` are never published, so the package
 * has to carry them inside it. The bundle does both. A clone still runs the
 * TypeScript directly and never holds dist/.
 *
 * `pnpm build` passes `--logLevel warn`, so a build that worked says nothing.
 * The flag and not the config, because tsdown speaks before it reads the
 * config, and `pnpm pack --json` prints its report on the same stdout.
 *
 * One entry, `src/cli.ts`: the npm package is the command line alone, and the
 * Host and the window live in the App (ADR-0024). The bundle carries no window
 * library and no dependency, so a package install pulls nothing else.
 */
import { defineConfig } from 'tsdown';

// biome-ignore lint/style/noDefaultExport: tsdown reads its config from the default export.
export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'dist',
  // The package is "type": "module", so .js is already ESM.
  fixedExtension: false,
  clean: true,
  dts: false,
  sourcemap: false,
});
