// These frames are trusted ONLY after receiving them over a key-confirmed PAKE
// channel. Parsing a public record with these functions does not authenticate it.
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function parse(text,type,fields){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>512)throw Error('Invalid handoff size');
 const value=JSON.parse(text);
 if(!value||Array.isArray(value)||value.v!==1||value.type!==type||Object.keys(value).sort().join(',')!==fields||!id(value.hostId)||!id(value.roomId))throw Error('Invalid handoff frame');
 return value;
}
function locator(value){
 if(!value||value.v!==1||!id(value.hostId)||!id(value.sessionId)||Object.keys(value).sort().join(',')!=='hostId,sessionId,v')throw Error('Invalid host locator');
 return value;
}
export function offerFrame(value){
 const host=locator(value);return JSON.stringify({v:1,type:'iroh-offer',hostId:host.hostId,roomId:host.sessionId});
}
export function readOffer(text){
 const value=parse(text,'iroh-offer','hostId,roomId,type,v');
 return Object.freeze({v:1,hostId:value.hostId,sessionId:value.roomId});
}
export function claimFrame(host,guestId){
 locator(host);if(!id(guestId)||guestId===host.hostId)throw Error('Invalid guest identity');
 return JSON.stringify({v:1,type:'iroh-claim',hostId:host.hostId,roomId:host.sessionId,guestId});
}
function readBound(text,type,host,guestId){
 locator(host);const value=parse(text,type,'guestId,hostId,roomId,type,v');
 if(!id(value.guestId)||value.guestId===value.hostId||value.hostId!==host.hostId||value.roomId!==host.sessionId||(guestId!==undefined&&value.guestId!==guestId))throw Error('Handoff identity or generation mismatch');
 return Object.freeze({hostId:value.hostId,roomId:value.roomId,guestId:value.guestId});
}
export const readClaim=(text,host)=>readBound(text,'iroh-claim',host);
export function boundPending(claim,pending,liveHostId){
 if(!claim||!id(claim.hostId)||!id(claim.roomId)||!id(claim.guestId)||claim.guestId===claim.hostId||claim.hostId!==liveHostId||!pending||pending.peerId!==claim.guestId||pending.roomId!==claim.roomId||typeof pending.requestId!=='string'||!/^\d+$/.test(pending.requestId))throw Error('Live peer does not match authenticated handoff');
 return Object.freeze({peerId:pending.peerId,roomId:pending.roomId,requestId:pending.requestId});
}
export function receiptFrame(claim){
 const host={v:1,hostId:claim.hostId,sessionId:claim.roomId};
 return claimFrame(host,claim.guestId).replace('iroh-claim','iroh-receipt');
}
export const readReceipt=(text,host,guestId)=>{
 if(!id(guestId))throw Error('Expected guest identity required');
 return readBound(text,'iroh-receipt',host,guestId);
};
