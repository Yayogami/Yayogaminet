const encoder=new TextEncoder();
export async function peerProof(secret,roomId,nonce,role) {
  if(!/^[a-f0-9]{64}$/.test(secret)||!/^[a-f0-9]{64}$/.test(nonce))throw new Error('Invalid invitation handshake.');
  const bytes=Uint8Array.from(secret.match(/../g),value=>parseInt(value,16));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(`meadow-v1:${roomId}:${nonce}:${role}`));
  return Array.from(new Uint8Array(signature),value=>value.toString(16).padStart(2,'0')).join('');
}
