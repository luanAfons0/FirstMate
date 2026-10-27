// A fixture Plugin Server that ends on SIGTERM, and leaves behind a child of
// its own that ignores SIGTERM.
//
// It says its own pid and the child's on stderr, so that a test can look
// whether the child outlives its Plugin Server: after a restart, after a Host
// stop, and after the Plugin Server ends on its own. The Host runs it with its
// own Node (ADR-0028), and the child is the same Node.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

type Request = {
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: { readonly protocolVersion?: string };
};

const child = spawn(
  process.execPath,
  ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 60_000);"],
  { stdio: 'ignore' },
);
process.stderr.write(`parting-parent: the Plugin Server has pid ${process.pid}\n`);
process.stderr.write(`parting-parent: started a child with pid ${child.pid ?? 'none'}\n`);

process.on('SIGTERM', () => {
  process.stderr.write('parting-parent: SIGTERM, and leaving\n');
  process.exit(0);
});
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
      serverInfo: { name: 'parting-parent', version: '1.0.0' },
    },
  });
});
