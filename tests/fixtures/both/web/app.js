// A Plugin Page calls its own tools with one ordinary HTTP request. There is no
// bridge API to learn: the body is an MCP JSON-RPC request, and the cookie the
// Host set on the first navigation goes with it.
const said = document.getElementById('said');
const call = async (method, params) => {
  const answer = await fetch('rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return answer.json();
};

document.getElementById('ask').addEventListener('click', async () => {
  said.textContent = 'asking.';
  try {
    const tools = await call('tools/list', {});
    const echoed = await call('tools/call', { name: 'echo', arguments: { text: 'hello' } });
    said.textContent = JSON.stringify({ tools, echoed }, null, 2);
  } catch (fault) {
    said.textContent = String(fault);
  }
});

document.getElementById('who').dataset.loaded = 'app.js';
