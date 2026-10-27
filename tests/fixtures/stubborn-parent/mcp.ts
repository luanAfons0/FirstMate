// A fixture Plugin Server that starts a child of its own and will not end
// when it is asked to.
//
// It ignores SIGTERM and the end of its stdin, and so does its child. It says
// the child's pid on stderr, so that a test can look whether the child
// outlives a restart and a Host stop. The Host runs it with its own Node
// (ADR-0028), and the child is the same Node.
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
process.stderr.write(`stubborn-parent: started a child with pid ${child.pid ?? 'none'}\n`);

process.on('SIGTERM', () => process.stderr.write('stubborn-parent: SIGTERM, and staying\n'));
// Something to keep the process up after its stdin has closed.
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
      serverInfo: { name: 'stubborn-parent', version: '1.0.0' },
    },
  });
});
