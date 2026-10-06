/**
 * How the App is built: its main process, as one bundle, with the Host inside
 * it.
 *
 * The App has a main process and nothing else to build. Its window shows the
 * Index Page, which the Host serves, so there is no renderer and no preload
 * here (ADR-0008, ADR-0020).
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
});
