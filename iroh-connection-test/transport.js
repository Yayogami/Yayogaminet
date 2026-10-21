export function parseInvitation(text) {
  if (typeof text !== 'string' || text.length > 512) throw new Error('Invalid invitation');
  const value = JSON.parse(text);
  if (!value || Object.keys(value).sort().join(',') !== 'id,token,v' || value.v !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.token)) {
    throw new Error('Invitation must contain a version, endpoint key, and session token only');
  }
  return value;
}

export class PrivacyClient extends EventTarget {
  #worker;
  #workerUrl;
  #revokeWorkerUrl() {
    if (this.#workerUrl) URL.revokeObjectURL(this.#workerUrl);
    this.#workerUrl = undefined;
  }
  #pending = new Map();
  #serial = 0;
  #closed = false;
  #state = 'idle';
  #closing;
  #finishClose;
  #closeId;
  get status() { return { state: this.#state, transport: 'iroh-wasm-relay', anonymityVerified: false }; }
  #emit(type, value) {
    if (type === 'connected') this.#state = 'connected';
    if (type === 'disconnected') this.#state = 'disconnected';
    this.dispatchEvent(new CustomEvent('event', { detail: { type, value } }));
  }
  async start(invitation) {
    if (this.#worker || this.#closed) throw new Error('Create a fresh client for each session');
    const parsed = invitation ? parseInvitation(invitation) : null;
    const token = parsed?.token ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
    this.#state = 'starting';
    try {
    // A blob entry inherits the document CSP, including on headerless hosts.
    // Import a fixed same-origin module; invitation data never enters this code.
    const entry = `import ${JSON.stringify(new URL('./worker.js', import.meta.url).href)};`;
    this.#workerUrl = URL.createObjectURL(new Blob([entry], { type: 'text/javascript' }));
    this.#worker = new Worker(this.#workerUrl, { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      this.#revokeWorkerUrl(); // First reply proves the bootstrap was consumed.
      if (this.#closed) {
        if (data.id === this.#closeId) this.#finishClose?.();
        return;
      }
      if (data.event) {
        this.#emit(data.event.type, data.event.value);
        if (data.event.type === 'disconnected') void this.close();
        return;
      }
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(data.id);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
    };
    this.#worker.onerror = event => {
      event.preventDefault(); // Handled here; do not also surface an uncaught page error.
      if (this.#closed) return;
      this.#emit('error', 'Transport worker failed');
      void this.close({ force: true });
    };
      const id = await this.#call('start', [token, !parsed]);
      if (this.#closed) throw new Error('Session closed');
      this.#state = 'ready';
      this.#emit('ready', id);
      if (parsed) await this.#call('connect', [parsed.id]);
      if (this.#closed) throw new Error('Session closed');
      return parsed ? null : JSON.stringify({ v: 1, id, token });
    } catch (error) { await this.close(); throw error; }
  }
  async send(text) {
    if (this.#state !== 'connected') throw new Error('No authenticated peer');
    if (typeof text !== 'string' || !text.length || new TextEncoder().encode(text).length > 4096) throw new Error('Use 1–4096 UTF-8 bytes');
    try { return await this.#call('send', [text]); }
    catch (error) { await this.close(); throw error; }
  }
  #call(op, args = []) {
    if (!this.#worker || this.#closed) return Promise.reject(new Error('Session closed'));
    const id = ++this.#serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('Transport timed out; session stopped without direct fallback'));
        this.close();
      }, 30000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#worker.postMessage({ id, op, args });
    });
  }
  close({ force = false } = {}) {
    if (this.#closed) {
      if (force) this.#finishClose?.();
      return this.#closing;
    }
    const graceful = !force && this.#worker && this.#pending.size === 0 && this.#state !== 'starting';
    this.#closed = true;
    this.#state = 'closed';
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Session closed'));
    }
    this.#pending.clear();
    const worker = this.#worker;
    this.#worker = undefined;
    this.#revokeWorkerUrl();
    this.#closing = new Promise(resolve => {
      let timer;
      this.#finishClose = () => {
        clearTimeout(timer);
        worker?.terminate();
        this.#finishClose = undefined;
        resolve();
      };
      if (graceful) {
        // Give Iroh a bounded opportunity to flush QUIC close. Local state is
        // already closed and late worker events cannot revive the session.
        timer = setTimeout(() => this.#finishClose?.(), 1500);
        this.#closeId = ++this.#serial;
        try { worker.postMessage({ id: this.#closeId, op: 'close', args: [] }); }
        catch { this.#finishClose(); }
      } else this.#finishClose();
    });
    this.#emit('closed', 'Local session ended');
    return this.#closing;
  }
}
