/**
 * FirstMate's mark, running and stopped: the icons the window, the Tray and
 * the Notices wear.
 *
 * They are the 1.x marks, packed with the App under `resources/icons`. The
 * path is found from the App's own directory, which is `apps/desktop` when the
 * App runs from a clone and the archive inside the program once it is
 * packaged, so neither needs a step to put them there.
 *
 * Windows reads an ICO, which holds every size its taskbar and Tray ask for.
 * Electron reads no ICO on Linux, so each mark is there as a PNG too
 * (ADR-0026).
 */
import { join } from 'node:path';
import { app } from 'electron';

/** Which mark: every Plugin is fine, or at least one is Stopped. */
export type Mark = 'running' | 'stopped';

/** The kind of image file a mark is read from on this system. */
const EXTENSION = process.platform === 'win32' ? 'ico' : 'png';

/** The path of one mark. */
export function markPath(mark: Mark): string {
  return join(app.getAppPath(), 'resources', 'icons', `firstmate-${mark}.${EXTENSION}`);
}
