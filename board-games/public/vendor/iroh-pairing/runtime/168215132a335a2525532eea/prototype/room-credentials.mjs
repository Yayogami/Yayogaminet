// Browser-compatible primitives. Keep the returned token private; it is not
// a directory record. This module does not reserve aliases or perform discovery.
const ALPHABET='abcdefghijklmnopqrstuvwxyz234567';
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
export function createRoomCredentials() {
  return Object.freeze({alias:createRoomAlias(),sessionId:createSessionId(),token:createSessionId()});
}
export function createRoomAlias() {
  // 32 divides 256 exactly: masking introduces no modulo bias.
  return Array.from(crypto.getRandomValues(new Uint8Array(10)),byte=>ALPHABET[byte&31]).join('');
}
export const createSessionId=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export function parseRoomAlias(value) {
  if(typeof value!=='string')throw Error('Invalid room code');
  const alias=value.trim().toLowerCase();
  if(!/^[a-z2-7]{10}$/.test(alias))throw Error('Use the ten-character room code');
  return alias;
}
export function roomLocator({alias,sessionId,hostId}) {
  // Explicit projection: never serialize an entire credential object to publish.
  if(typeof sessionId!=='string'||!/^[a-f0-9]{64}$/.test(sessionId)||
     typeof hostId!=='string'||!/^[a-f0-9]{64}$/.test(hostId))throw Error('Invalid room locator');
  return Object.freeze({v:1,alias:parseRoomAlias(alias),sessionId,hostId});
}
