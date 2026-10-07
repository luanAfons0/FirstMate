// A fixture Plugin Server in plain JavaScript, shipped as mcp.js alone. The
// Host runs it with its own Node (ADR-0028). It holds every line it runs, so
// an answer proves that a plain .js file starts, with no TypeScript near it.
// It answers with the name of the file the Host started, which is its one
// argument.
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

const started = basename(process.argv[1] ?? 'nothing');
const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = (id, value) => reply({ jsonrpc: '2.0', id, result: value });

process.stderr.write(`node-js: the Plugin Server is up from ${started}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const request = JSON.parse(line);
  if (request.id === undefined || request.id === null) continue;
  switch (request.method) {
    case 'initialize':
      result(request.id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'node-js', version: '1.0.0' },
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
