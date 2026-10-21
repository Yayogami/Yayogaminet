import init, { PrivacyNode } from './wasm/iroh_browser_proof.js';
import { installRelayPolicy } from './relay-policy.js';
installRelayPolicy();
let node;
let initialized;
let busy = false;
self.onmessage = async ({ data: { id, op, args = [] } }) => {
  if (busy) { postMessage({ id, error: 'Another operation is in progress' }); return; }
  busy = true;
  try {
    let result;
    if (op === 'start') {
      if (node) throw new Error('Session already started');
      initialized ??= init();
      await initialized;
      node = await PrivacyNode.start(args[0], args[1], value => postMessage({ event: JSON.parse(value) }));
      result = node.endpoint_id();
    } else if (op === 'connect') {
      await node.connect(args[0]);
    } else if (op === 'send') {
      await node.send(args[0]);
    } else if (op === 'close') {
      await node?.close();
      node?.free();
      node = undefined;
    } else throw new Error('Unknown operation');
    postMessage({ id, result });
  } catch (error) {
    postMessage({ id, error: String(error.message || error) });
  } finally { busy = false; }
};
