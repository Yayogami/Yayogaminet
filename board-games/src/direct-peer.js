// Connection transport only. Room authority, identity and consent belong above it.
const LABEL = 'meadow-room-v1';
const MAX_BYTES = 65536;
const encoder = new TextEncoder();
let library;

// State names and candidate counts only: never expose addresses or invitation data.
export function connectionDiagnostics(rtc) {
  if (!rtc) return 'WebRTC connection not created';
  const candidates = description => {
    const sdp = description?.sdp || '';
    return ['host', 'srflx', 'relay'].map(type => `${type}:${(sdp.match(new RegExp(` typ ${type}(?: |\\r|\\n|$)`, 'g')) || []).length}`).join(',');
  };
  return `ICE=${rtc.iceConnectionState || 'unknown'}; gathering=${rtc.iceGatheringState || 'unknown'}; signaling=${rtc.signalingState || 'unknown'}; local[${candidates(rtc.localDescription)}]; remote[${candidates(rtc.remoteDescription)}]`;
}

export function directPeerOptions() {
  return {
    host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
    // Override PeerJS defaults explicitly: no TURN credentials or relay servers.
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceTransportPolicy: 'all' },
  };
}

async function loadPeer() {
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../public/vendor/peerjs/dist/peerjs.min.js', import.meta.url).href;
    script.onload = () => typeof globalThis.Peer === 'function' ? resolve(globalThis.Peer) : reject(new Error('PeerJS failed to load.'));
    script.onerror = () => { library = null; script.remove(); reject(new Error('Could not load the peer connection library.')); };
    document.head.append(script);
  });
  return library;
}

export async function createDirectPeer({ id, PeerConstructor, timeoutMs = 15000, onConnection = () => {}, onError = () => {} } = {}) {
  const Constructor = PeerConstructor || await loadPeer();
  const peer = new Constructor(id, directPeerOptions());
  const channels = new Set();
  let destroyed = false;
  function wrap(connection) {
    let ended = false, opened = false, settleReady, rejectReady;
    const messages = new Set(), closures = new Set();
    const ready = new Promise((resolve,reject) => { settleReady = resolve; rejectReady = reject; });
    // Incoming channels can fail before the application awaits readiness.
    ready.catch(() => {});
    const timer = setTimeout(() => {
      const rtc=connection.peerConnection;
      const details=connectionDiagnostics(rtc);
      console.warn(`Direct P2P timeout: ${details}`);
      end(new Error(`Direct connection failed. Relay fallback is disabled. Connection details: ${details}`));
    }, timeoutMs);
    function end(error = new Error('Peer connection closed.')) {
      if (ended) return;
      ended = true; clearTimeout(timer); channels.delete(channel);
      if (!opened) rejectReady(error);
      connection.close();
      for (const listener of closures) listener(error);
      messages.clear(); closures.clear();
    }
    const channel = {
      peerId: connection.peer, ready,
      send(value) {
        if (ended || !opened) throw new Error('The peer connection is not open.');
        const encoded = JSON.stringify({ protocol: LABEL, payload: value });
        if (encoder.encode(encoded).byteLength > MAX_BYTES) throw new Error('Peer message is too large.');
        connection.send(encoded);
      },
      onMessage(listener) { messages.add(listener); return () => messages.delete(listener); },
      onClose(listener) { closures.add(listener); return () => closures.delete(listener); },
      close: end,
    };
    channels.add(channel);
    connection.on('open', () => { if (!ended) { opened = true; clearTimeout(timer); settleReady(channel); } });
    connection.on('close', () => end());
    connection.on('error', error => end(error));
    connection.on('data', raw => {
      if (ended || !opened) return;
      let message;
      try {
        if (typeof raw !== 'string' || encoder.encode(raw).byteLength > MAX_BYTES) throw new Error();
        message = JSON.parse(raw);
        if (!message || message.protocol !== LABEL || !Object.hasOwn(message,'payload')) throw new Error();
      } catch { end(new Error('Invalid peer message.')); return; }
      for (const listener of messages) listener(message.payload);
    });
    return channel;
  }
  peer.on('connection', connection => {
    if (destroyed || connection.label !== LABEL || connection.serialization !== 'raw' || channels.size >= 8) { console.warn('Rejected incompatible peer channel');connection.close(); return; }
    onConnection(wrap(connection));
  });
  const close = () => {
    if (destroyed) return;
    destroyed = true;
    for (const channel of [...channels]) channel.close();
    peer.destroy();
  };
  peer.on('error', error => {
    // PeerJS reports unavailable peers on the Peer object, not just the channel.
    if (error.type === 'peer-unavailable') for (const channel of [...channels]) channel.close(error);
    onError(error);
  });
  const peerId = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => { close(); reject(new Error('Could not reach the PeerJS signaling service.')); }, timeoutMs);
    peer.on('open', value => { clearTimeout(timer); resolve(value); });
    peer.on('error', error => { clearTimeout(timer); reject(error); });
  }).catch(error => { close(); throw error; });
  return {
    id: peerId,
    connect(remoteId) {
      if (destroyed) throw new Error('Peer transport is closed.');
      if (typeof remoteId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,126}[A-Za-z0-9]$/.test(remoteId)) throw new Error('Invalid peer connection ID.');
      if (channels.size >= 8) throw new Error('Too many peer connections.');
      return wrap(peer.connect(remoteId, { label: LABEL, serialization: 'raw', reliable: true }));
    },
    reconnectSignaling() { if (!destroyed && peer.disconnected) peer.reconnect(); },
    close,
  };
}
