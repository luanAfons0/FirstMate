/**
 * How the App is built: its main process, with the Host inside it, and the
 * preload its own views carry.
 *
 * The window's views show pages the Host serves, so there is no renderer to
 * build. The one preload is for the App's own views, the strip, the switcher
 * and the Settings View, and never for a Plugin Page (ADR-0008, ADR-0020). A
 * sandboxed preload cannot be an ES module, so it is CommonJS, named `.cjs` so
 * that nothing reads it as one of the package's ES modules.
 *
 * `core` and `host` are dev dependencies, so the bundle carries them, as the
 * command line's bundle does (ADR-0017). Electron and Node's own modules stay
 * outside it, because the App's executable has them.
 */
import { defineConfig } from 'electron-vite';

// biome-ignore lint/style/noDefaultExport: electron-vite reads its config from the default export.
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: 'src/main.ts' } },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { app: 'src/preload.ts' },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
});
