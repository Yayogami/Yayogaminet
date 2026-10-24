import {MAILBOX_URL,MAILBOX_APP,decodeMailboxMessage,cleanupTicket} from '../mailbox-cleanup.mjs';
import * as mailboxLibrary from '../mailbox-wasm/wormhole_feasibility.js';
const Native=globalThis.WebSocket;
let socket,host,channel,library,working=false,stopped=false,dirty=false,own={side:null,nameplate:null,mailbox:null};
let heartbeat,deadline,pingSerial=0,expectedPong,peerFrames=0,pairingAnnounced=false;
const report=()=>postMessage({event:'receipt',value:{...own,dirty}});
function fail(reason){if(stopped)return;stopped=true;clearInterval(heartbeat);clearTimeout(deadline);try{socket?.close();}catch{}postMessage({event:'lost',reason});}
globalThis.WebSocket=class extends Native {
 constructor(url,...args){
  if(url!==MAILBOX_URL||socket)throw Error('Mailbox destination refused');
  super(url,...args);socket=this;this.binaryType='arraybuffer';
  // Bound service-control traffic as well as peer frames. Normal handshake
  // bursts fit within 64 frames; idle ping/ack/pong traffic uses far less than
  // the eight frames/second refill. This cannot bound browser/TLS buffering.
  let frameBudget=64,budgetAt=performance.now(),protocolFrames=0;
  this.addEventListener('message',event=>{
   if(stopped){event.stopImmediatePropagation();return;}
   let failure='invalid-frame';
   try{
    const now=performance.now();frameBudget=Math.min(64,frameBudget+Math.max(0,now-budgetAt)*0.008);budgetAt=now;
    if(frameBudget<1){failure='frame-rate';throw Error('Mailbox frame rate exceeded');}frameBudget--;
    const frame=decodeMailboxMessage(event.data);
    if(frame.type==='pong'){
     event.stopImmediatePropagation();
     if(expectedPong!==undefined&&frame.pong===expectedPong){expectedPong=undefined;clearTimeout(deadline);postMessage({event:'alive'});}return;
    }
    if(frame.type==='ack'&&String(frame.id).startsWith('health-')){event.stopImmediatePropagation();return;}
    // ws_stream_wasm queues forwarded frames without an intrinsic capacity.
    // Pairing is a finite exchange. Consume health traffic above, and bound all
    // other frames across this worker's lifetime (including a slow control flood).
    if(++protocolFrames>128){failure='protocol-budget';throw Error('Mailbox protocol budget exceeded');}
    if(frame.type==='allocated'){own.nameplate=frame.nameplate;report();}
    if(frame.type==='claimed'){own.mailbox=frame.mailbox;report();}
    if(frame.type==='message'&&frame.side!==own.side){
     if(++peerFrames>16){failure='peer-budget';throw Error('Mailbox message budget exceeded');}
     if(!pairingAnnounced){pairingAnnounced=true;postMessage({event:'pairing'});}
    }
   }catch{event.stopImmediatePropagation();fail(failure);}
  });
  this.addEventListener('open',()=>{
   heartbeat=setInterval(()=>{
    if(stopped||expectedPong!==undefined)return;
    expectedPong=++pingSerial;
    try{
     Native.prototype.send.call(this,new TextEncoder().encode(JSON.stringify({type:'ping',ping:expectedPong,id:'health-'+expectedPong})));
     deadline=setTimeout(()=>fail('heartbeat-timeout'),5000);
    }catch{fail('heartbeat-send');}
   },10000);
  });
  this.addEventListener('close',()=>fail('socket-close'));this.addEventListener('error',()=>fail('socket-error'));
 }
 send(data){
  if(stopped)throw Error('Mailbox stopped');
  const frame=decodeMailboxMessage(data);
  if(frame.type==='bind'){
   if(frame.appid!==MAILBOX_APP||!/^[a-f0-9]{10}$/.test(frame.side))throw Error('Invalid mailbox binding');
   own.side=frame.side;
  }
  if(frame.type==='allocate'||frame.type==='claim'){dirty=true;if(frame.nameplate)own.nameplate=frame.nameplate;}
  report();return super.send(data);
 }
};
// Static imports retain the bootstrap's no-referrer policy in module workers.
// Delay WASM initialization until the first operation, after service consent.
async function wasm(){if(!library){await mailboxLibrary.default();library=mailboxLibrary;}return library;}
self.onmessage=async({data})=>{
 const {id,op,value}=data;
 if(working||stopped){postMessage({id,error:'Mailbox unavailable'});return;}
 working=true;
 try{
  let result;
  if(op==='create'){host=await(await wasm()).create_compact_host();result=host.code();}
  else if(op==='open'){const instance=host;host=undefined;channel=await instance.open();}
  else if(op==='join'){channel=await(await wasm()).join_compact(value);}
  else if(op==='send'){await channel.send(value);}
  else if(op==='receive'){result=await channel.receive();}
  else if(op==='ticket'){result=cleanupTicket(own);}
  else throw Error('Unknown mailbox operation');
  if(!stopped)postMessage({id,result});
 }catch{if(!stopped)postMessage({id,error:'Pairing failed; use a fresh code'});}
 finally{working=false;}
};
postMessage({event:'alive'});
