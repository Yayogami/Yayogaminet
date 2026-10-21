// Defense against transport-selected destinations, not against compromised app code.
// Keep the blob worker's inherited document CSP as an independent browser boundary.
export function relaySocketUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'wss:' ||
      !['use1-1.relay.n0.iroh.link', 'use1-1.relay.n0.iroh.link.'].includes(url.hostname) ||
      url.port || url.username || url.password || url.pathname !== '/relay' ||
      url.search || url.hash) {
    throw new Error('Blocked destination outside the approved relay');
  }
  url.hostname = 'use1-1.relay.n0.iroh.link';
  return url.href;
}

export function installRelayPolicy(scope = globalThis) {
  const NativeWebSocket = scope.WebSocket;
  const nativeFetch = scope.fetch.bind(scope);
  const wasmUrl = new URL('./wasm/iroh_browser_proof_bg.wasm', import.meta.url).href;
  async function restrictedFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const relayProbe = url.protocol === 'https:' &&
      ['use1-1.relay.n0.iroh.link', 'use1-1.relay.n0.iroh.link.'].includes(url.hostname) &&
      !url.port && !url.username && !url.password && url.pathname === '/ping' &&
      !url.search && !url.hash;
    if (request.method !== 'GET' || (!relayProbe && url.href !== wasmUrl)) {
      throw new Error('Blocked HTTP destination outside transport resources');
    }
    // The URL allowlist alone cannot constrain the target of a redirect.
    // Firefox rejects trailing-dot host sources in CSP. Use the same approved
    // DNS name without the final dot for both HTTP and WebSocket connections.
    if (relayProbe) url.hostname = 'use1-1.relay.n0.iroh.link';
    return nativeFetch(new Request(url.href, {
      method: request.method, headers: request.headers, signal: request.signal,
      mode: request.mode, cache: request.cache,
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
    }));
  }
  class RelayWebSocket extends NativeWebSocket {
    constructor(url, ...args) {
      // Validate before invoking the native constructor (and before any DNS/socket work).
      super(relaySocketUrl(url), ...args);
    }
  }
  Object.defineProperty(scope, 'WebSocket', {
    value: RelayWebSocket, writable: false, configurable: false,
  });
  Object.defineProperty(scope, 'fetch', {
    value: restrictedFetch, writable: false, configurable: false,
  });
}
