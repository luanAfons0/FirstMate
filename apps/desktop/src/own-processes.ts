/**
 * The App's own processes: what FirstMate's row of Usage counts in the App.
 *
 * The Host reads Usage, but only the App knows which of its processes are
 * its own, so it gives the Host their PIDs through a start hook, and the Host
 * takes no Electron import (ADR-0032). FirstMate's cost is every process
 * Electron runs for the App: the main process, the GPU process, its helpers,
 * and the renderers of the App's own views and of the Index Page, even while
 * they load. A Plugin Page's renderer is the Plugin's cost, and FirstMate's
 * row never counts it. A Plugin Server is no process of Electron's, and has a
 * row of its own.
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
  // to make it the Plugin's. A renderer that shows no Plugin Page is the
  // App's: one whose page is still blank or on its way, and one Electron
  // keeps ready for the next page, which shows no page yet.
  const plugins = new Set<number>();
  for (const page of webContents.getAllWebContents()) {
    if (page.isDestroyed()) continue;
    const pid = page.getOSProcessId();
    if (pid > 0 && isPluginPage(page, host)) plugins.add(pid);
  }
  return app
    .getAppMetrics()
    .filter((metric) => metric.type !== RENDERER || !plugins.has(metric.pid))
    .map((metric) => metric.pid);
}

/**
 * Whether a view shows a Plugin Page: an address on the Host that a Plugin
 * owns, or one off the Host that a Plugin Page went to. A page of the App's
 * own, written as a data address, the Index Page, and a blank page are not.
 */
function isPluginPage(page: WebContents, host: HostAt | undefined): boolean {
  const address = page.getURL();
  if (address === '' || address === 'about:blank' || address.startsWith('data:')) return false;
  return host === undefined || ownerOf(host, address) !== INDEX;
}
