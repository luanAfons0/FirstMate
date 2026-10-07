// A fixture Plugin Server in TypeScript, shipped as mcp.ts alone. The Host
// runs it with its own Node (ADR-0028). Its type annotations are no
// JavaScript, so it runs only on a Node that strips types: the Node the Host
// names, and under the App the App itself.
// It answers with the name of the file the Host started, which is its one
// argument, so a test can tell which form won. Other fixtures import it.
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

type Request = { readonly id?: number | string | null; readonly method: string };

const started: string = basename(process.argv[1] ?? 'nothing');
const reply = (message: object): boolean => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = (id: number | string, value: object): boolean =>
  reply({ jsonrpc: '2.0', id, result: value });

process.stderr.write(`node-form: the Plugin Server is up from ${started}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const request = JSON.parse(line) as Request;
  if (request.id === undefined || request.id === null) continue;
  switch (request.method) {
    case 'initialize':
      result(request.id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'node-form', version: '1.0.0' },
      });
      break;
    case 'tools/call':
      result(request.id, { content: [{ type: 'text', text: `pong from ${started}` }] });
      break;
    default:
      reply({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `no such method: ${request.method}` },
      });
  }
}
