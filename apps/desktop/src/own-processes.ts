/**
 * The App's own processes: what FirstMate's row of Usage counts in the App.
 *
 * The Host reads Usage, but only the App knows which of its processes are
 * its own, so it gives the Host their PIDs through a start hook, and the Host
 * takes no Electron import (ADR-0032). FirstMate's cost is every process
 * Electron runs for the App: the main process, the GPU process, its helpers,
 * and the renderers of the App's own views and of the Index Page. A Plugin
 * Page's renderer is the Plugin's cost, and FirstMate's row never counts it.
 * A Plugin Server is no process of Electron's, and has a row of its own.
 */
import { app, webContents, type WebContents } from 'electron';
import { INDEX, ownerOf, type HostAt } from './addresses.ts';

/** The type Electron gives the process of a renderer. */
const RENDERER = 'Tab';

/**
 * The PIDs of the App's own processes now. Before the Host listens, no Plugin
 * Page has loaded, and only the App's own pages show.
 */
export function ownProcesses(host: HostAt | undefined): number[] {
  // A renderer may show several pages, and one Plugin Page in it is enough
  // to make it the Plugin's.
  const own = new Set<number>();
  const plugins = new Set<number>();
  for (const page of webContents.getAllWebContents()) {
    if (page.isDestroyed()) continue;
    const pid = page.getOSProcessId();
    if (pid > 0) (isOwnPage(page, host) ? own : plugins).add(pid);
  }
  return app
    .getAppMetrics()
    .filter((metric) =>
      metric.type === RENDERER ? own.has(metric.pid) && !plugins.has(metric.pid) : true,
    )
    .map((metric) => metric.pid);
}

/**
 * Whether a view shows a page of the App's own, written as a data address,
 * or the Index Page. Anything else, a blank page or one still on its way,
 * may be a Plugin's, so it is not counted as the App's.
 */
function isOwnPage(page: WebContents, host: HostAt | undefined): boolean {
  const address = page.getURL();
  if (address.startsWith('data:')) return true;
  return host !== undefined && address !== '' && ownerOf(host, address) === INDEX;
}
