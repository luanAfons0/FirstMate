// A fixture Plugin Server that ends on SIGTERM, and starts a child that
// needs a moment to end cleanly: on SIGTERM it waits a little, says it is
// done, and ends.
//
// The child says when it hears SIGTERM, so that a test asks no sooner. A test
// reads the child's last line in the Host's output, so it can see
// whether the child had the time to end cleanly or was killed first. The Host
// runs it with its own Node (ADR-0028), and the child is the same Node.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

type Request = {
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: { readonly protocolVersion?: string };
};

const child = spawn(
  process.execPath,
  [
    '-e',
    `process.on('SIGTERM', () => setTimeout(() => {
      process.stderr.write('tidy-parent: the child ended cleanly\\n');
      process.exit(0);
    }, 300));
    process.stderr.write('tidy-parent: the child waits for SIGTERM\\n');
    setInterval(() => {}, 60_000);`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
process.stderr.write(`tidy-parent: the Plugin Server has pid ${process.pid}\n`);
process.stderr.write(`tidy-parent: started a child with pid ${child.pid ?? 'none'}\n`);

process.on('SIGTERM', () => process.exit(0));
// Something to keep the process up after its stdin has closed, so that only
// SIGTERM ends it.
setInterval(() => {}, 60_000);

const reply = (message: object): boolean => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const request = JSON.parse(line) as Request;
  if (request.method !== 'initialize' || request.id === undefined || request.id === null) return;
  reply({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
      capabilities: {},
      serverInfo: { name: 'tidy-parent', version: '1.0.0' },
    },
  });
});
