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
 * Two entries, so that the Host's entry point sits beside the command line in
 * the build as it does in a clone: the service unit names `main.js`, and the
 * Tray reads `cli.js` beside it.
 *
 * `@webviewjs/webview` is a dependency, and tsdown leaves a dependency outside
 * the bundle. It stays the dynamic import `src/desktop.ts` makes, inside the
 * chunk only `firstmate desktop` loads, so every other command still runs where
 * the native binary will not load (ADR-0011).
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
