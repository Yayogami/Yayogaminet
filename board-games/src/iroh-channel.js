// Ordered, bounded framing for the existing game's RPC messages over 4 KiB Iroh frames.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const CHUNK=2400,MAX_MESSAGE=65536,MAX_QUEUE=4*1024*1024;
const encode=bytes=>btoa(String.fromCharCode(...bytes));
function decode(text){if(typeof text!=='string'||text.length>3200||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw Error('Invalid transport bytes');return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export function createIrohChannel({sendText,closeTransport,peerId='approved-peer'}){
 let ended=false,sequence=0,received=0,partial=null,queued=0,tail=Promise.resolve();
 const messages=new Set(),closures=new Set();
 const channel={peerId,ready:Promise.resolve(),
  send(value){
   if(ended)throw Error('The peer connection is not open.');
   const bytes=encoder.encode(JSON.stringify(value));
   if(!bytes.length||bytes.length>MAX_MESSAGE)throw Error('Peer message is too large.');
   if(queued+bytes.length>MAX_QUEUE)throw Error('Room synchronization queue is full.');
   if(!Number.isSafeInteger(sequence+1))throw Error('Transport sequence exhausted.');
   const id=++sequence,total=Math.ceil(bytes.length/CHUNK);queued+=bytes.length;
   const work=tail.then(async()=>{
    for(let index=0;index<total;index++){
     if(ended)throw Error('Peer connection interrupted. Delivery may be unknown.');
     await sendText(JSON.stringify({v:1,id,index,total,body:encode(bytes.subarray(index*CHUNK,(index+1)*CHUNK))}));
    }
   }).catch(error=>{const failure=Error('Peer connection interrupted. Delivery may be unknown; it was not resent.',{cause:error});channel.close(failure);throw failure;}).finally(()=>{queued-=bytes.length;});
   // Legacy RPC sends synchronously. Failure closes the channel and rejects RPCs.
   tail=work.catch(()=>{});return work;
  },
  receive(text){
   if(ended)return;
   try{
    if(typeof text!=='string'||encoder.encode(text).length>3600)throw Error();
    const f=JSON.parse(text);
    if(!f||Object.keys(f).sort().join(',')!=='body,id,index,total,v'||f.v!==1||!Number.isSafeInteger(f.id)||f.id!==received+1||!Number.isInteger(f.index)||!Number.isInteger(f.total)||f.total<1||f.total>Math.ceil(MAX_MESSAGE/CHUNK))throw Error();
    if(!partial){if(f.index!==0)throw Error();partial={id:f.id,total:f.total,next:0,bytes:[],length:0};}
    if(f.id!==partial.id||f.total!==partial.total||f.index!==partial.next)throw Error();
    const bytes=decode(f.body);if(!bytes.length||bytes.length>CHUNK||(f.index<f.total-1&&bytes.length!==CHUNK))throw Error();
    partial.length+=bytes.length;if(partial.length>MAX_MESSAGE)throw Error();partial.bytes.push(bytes);partial.next++;
    if(partial.next===partial.total){
     const joined=new Uint8Array(partial.length);let offset=0;for(const part of partial.bytes){joined.set(part,offset);offset+=part.length;}
     const value=JSON.parse(decoder.decode(joined));partial=null;received++;
     for(const listener of messages)listener(value);
    }
   }catch{channel.close(Error('Invalid or replayed peer message.'));}
  },
  onMessage(listener){messages.add(listener);return()=>messages.delete(listener);},
  onClose(listener){closures.add(listener);return()=>closures.delete(listener);},
  close(error=Error('Peer connection closed.')){if(ended)return;ended=true;partial=null;closeTransport();for(const listener of closures)listener(error);messages.clear();closures.clear();},
 };
 return channel;
}
