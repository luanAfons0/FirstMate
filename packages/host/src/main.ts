/**
 * The Host: one long-running process that gives any Plugin a process, a page
 * and an address.
 *
 * Start it with `node packages/host/src/main.ts`. What starting it does is in
 * `start.ts`, which the App calls too (ADR-0020). This file is what a process
 * adds around it: the Host stops on a signal, and a Host that could not start
 * leaves a failing exit code.
 */
import { start } from './start.ts';

async function main(): Promise<void> {
  const host = await start();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      host.stop().catch((fault: unknown) => {
        console.error('FirstMate: the Host did not stop cleanly.', fault);
        process.exitCode = 1;
      });
    });
  }
}

main().catch((fault: unknown) => {
  console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
  if (fault instanceof Error && fault.cause !== undefined) console.error(fault.cause);
  process.exitCode = 1;
});
