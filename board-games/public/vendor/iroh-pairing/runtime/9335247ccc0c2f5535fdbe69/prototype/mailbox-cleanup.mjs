export const MAILBOX_URL = 'wss://relay.magic-wormhole.io/v1';
export const MAILBOX_APP = 'yayogami.net/iroh-compact-pairing-feasibility-v1';
export function cleanupTicket(value) {
 if (!value || Object.keys(value).sort().join(',') !== 'mailbox,nameplate,side' ||
     typeof value.side !== 'string' || !/^[0-9a-f]{10}$/.test(value.side) ||
     typeof value.nameplate !== 'string' || !/^[1-9][0-9]{0,4}$/.test(value.nameplate) || Number(value.nameplate)>32767 ||
     typeof value.mailbox !== 'string' || !/^[a-z0-9]{8,64}$/.test(value.mailbox)) throw Error('Invalid cleanup record');
 return Object.freeze({...value});
}
export function peerCleanupTicket(value, own) {
 const ticket=cleanupTicket(value),local=cleanupTicket(own);
 if(ticket.side===local.side || ticket.nameplate!==local.nameplate || ticket.mailbox!==local.mailbox) throw Error('Cleanup record does not match this mailbox');
 return ticket;
}
export function decodeMailboxMessage(data) {
 // Reject oversize input before allocating an encoded copy. Native sockets use
 // strings/ArrayBuffers; typed-array views also occur on our outbound path.
 if(typeof data==='string'&&data.length>32768)throw Error('Mailbox frame exceeds limit');
 if(typeof data!=='string'&&!(data instanceof ArrayBuffer)&&!ArrayBuffer.isView(data))throw Error('Invalid mailbox bytes');
 if(typeof data!=='string'&&data.byteLength>32768)throw Error('Mailbox frame exceeds limit');
 const bytes=typeof data==='string'?new TextEncoder().encode(data):ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
 if(bytes.byteLength>32768)throw Error('Mailbox frame exceeds limit');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!value||Array.isArray(value)||typeof value.type!=='string')throw Error('Invalid mailbox frame');
 return value;
}
// Idempotent shutdown only. NEVER claim/allocate/open here, even after a lost reply.
// No codes, keys, application payload or user-selected URLs are used.
export async function retireMailboxClaims(records,{Socket=globalThis.WebSocket,timeoutMs=6000}={}) {
 const tickets=records.map(cleanupTicket);
 if(tickets.length>2)throw Error('Too many cleanup records');
 if(tickets.length===2)peerCleanupTicket(tickets[1],tickets[0]);
 let confirmed=true;
 for(const ticket of tickets) {
  const ok=await new Promise(resolve=>{
   let socket,timer,done=false,released=false,closed=false,frames=0;
   const finish=result=>{if(done)return;done=true;clearTimeout(timer);try{socket?.close();}catch{}resolve(result);};
   timer=setTimeout(()=>finish(false),timeoutMs);
   try{
    socket=new Socket(MAILBOX_URL);socket.binaryType='arraybuffer';
    socket.onopen=()=>{
     const send=value=>socket.send(new TextEncoder().encode(JSON.stringify(value)));
     try{
      send({type:'bind',appid:MAILBOX_APP,side:ticket.side,id:'cleanup-bind'});
      send({type:'release',nameplate:ticket.nameplate,id:'cleanup-release'});
      send({type:'close',mailbox:ticket.mailbox,mood:'happy',id:'cleanup-close'});
     }catch{finish(false);}
    };
    socket.onmessage=event=>{
     if(done)return;
     try{
      if(++frames>32)throw Error();
      const frame=decodeMailboxMessage(event.data);
      if(frame.type==='error'||(frame.type==='welcome'&&frame.welcome?.error))throw Error();
      if(frame.type==='released')released=true;
      if(frame.type==='closed')closed=true;
      if(released&&closed)finish(true);
     }catch{finish(false);}
    };
    socket.onerror=()=>finish(false);socket.onclose=()=>finish(false);
   }catch{finish(false);}
  });
  confirmed=ok&&confirmed;
 }
 return confirmed;
}
