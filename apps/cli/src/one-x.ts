/**
 * Bringing a 1.x install across, as `import` and `setup` both do it: the
 * import itself, what it says, and the question about the 1.x service.
 *
 * The 1.x Host runs as a systemd service in its distribution and holds the
 * port the App listens on, so it is offered to be turned off, and turned off
 * only on yes (ADR-0021).
 */
import { importOneX, type Imported } from '@firstmate/core/import-1x';
import type { Place } from '@firstmate/core/places';
import { shortcutAddress } from '@firstmate/core/shortcut';
import { oneXServiceIn, stopOneXService } from '@firstmate/core/wsl';

/** Ask the operator yes or no, with yes as the answer Enter gives. */
type Confirm = (question: string) => Promise<boolean>;

/**
 * Import the 1.x install in this Place, say what came and what did not, and
 * offer to turn the 1.x service off. It gives back what was imported.
 */
export async function bringAcross(home: string, place: Place, confirm: Confirm): Promise<Imported> {
  const imported = importOneX(home, place);
  for (const row of imported.plugins) {
    console.log(`firstmate: imported ${row.name} at ${row.directory}, in ${row.place}`);
  }
  for (const shortcut of imported.shortcuts) {
    console.log(`firstmate: bound ${shortcut.keys} to open ${shortcutAddress(shortcut)}`);
  }
  if (imported.order !== undefined) {
    console.log(`firstmate: the Plugin Order is now ${imported.order.join(', ')}`);
  }
  if (imported.shelf !== undefined) {
    console.log(`firstmate: the Shelf of ${place.name} is now ${imported.shelf}`);
  }
  for (const sentence of imported.refused) console.error(`firstmate: ${sentence}`);

  if (place.kind === 'wsl' && (await oneXServiceIn(place.distribution))) {
    const { distribution } = place;
    const yes = await confirm(
      `The 1.x Host runs as a service in ${distribution}. Turn it off, so the App can listen?`,
    );
    if (yes) {
      await stopOneXService(distribution);
      console.log(`firstmate: turned off the 1.x service in ${distribution}.`);
    } else {
      console.log(`firstmate: the 1.x service in ${distribution} is left as it is.`);
    }
  }
  return imported;
}
