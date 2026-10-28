import {parseManualInvitation,encodeManualInvitation,validId} from './room-protocol.mjs';
import {directoryRequestHash} from '../directory-proof.mjs';
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export class ManualClient extends EventTarget {
 #worker;#url;#calls=new Map();#serial=0;#state='idle';#host=false;#pending;#generation;#closing;
 #roomId;#endpointId;#token;#discovery=false;
 get state(){return this.#state;}
 get busy(){return this.#calls.size>0;}
 get endpointId(){return this.#endpointId;}
 get pending(){return this.#pending?Object.freeze({...this.#pending}):null;}
 #emit(type,value){this.dispatchEvent(new CustomEvent('event',{detail:{type,value}}));}
 #set(state){this.#state=state;this.#emit('state',state);}
 #revoke(){if(this.#url){URL.revokeObjectURL(this.#url);this.#url=undefined;}}
 async start(invitation){
  return this.#start(invitation?parseManualInvitation(invitation):null);
 }
 async startDiscovery(roomId=random()){
  if(!validId(roomId))throw Error('Invalid room generation');
  return this.#start(null,roomId);
 }
 async joinDiscovered(locator){
  if(!locator||locator.v!==1||!validId(locator.hostId)||!validId(locator.sessionId)||
   !['hostId,sessionId,v','alias,hostId,sessionId,v'].includes(Object.keys(locator).sort().join(','))||
   ('alias' in locator&&(typeof locator.alias!=='string'||!/^[a-z2-7]{10}$/.test(locator.alias))))throw Error('Invalid public room locator');
  return this.#start({id:locator.hostId,token:locator.sessionId,roomId:locator.sessionId},locator.sessionId);
 }
 async #start(parsed,discoveryRoom){
  if(this.#state!=='idle')throw Error('Use a fresh session');
  this.#host=!parsed;this.#discovery=discoveryRoom!==undefined;
  const token=discoveryRoom??parsed?.token??random();this.#token=token;this.#roomId=discoveryRoom??parsed?.roomId??random();this.#set('starting');
  try{
   this.#url=URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL('./manual-worker.mjs',import.meta.url).href)};`],{type:'text/javascript'}));
   this.#worker=new Worker(this.#url,{type:'module',credentials:'omit'});
   this.#worker.onerror=e=>{e.preventDefault();this.#fail('Transport worker failed');};
   this.#worker.onmessage=({data})=>{
    this.#revoke();if(this.#state==='closed')return;
    if(data.event){try{this.#event(data.event);}catch{this.#fail('Invalid session protocol');}return;}
    const call=this.#calls.get(data.id);if(!call)return;
    clearTimeout(call.timer);this.#calls.delete(data.id);data.error?call.reject(Error(data.error)):call.resolve(data.result);
   };
   const id=await this.#call('start',[token,this.#host,this.#discovery]);
   if(this.#state==='closed')throw Error('Session closed');
   this.#endpointId=id;
   this.#set(this.#host?'waiting':'connecting');
   if(parsed)await this.#call('connect',[parsed.id]);
   if(this.#state==='closed')throw Error('Session closed');
   return parsed?null:this.#discovery?Object.freeze({v:1,hostId:id,sessionId:this.#roomId}):encodeManualInvitation({id,token,roomId:this.#roomId});
  }catch(error){this.close();throw error;}
 }
 bindRoom(locator){
  if(this.#discovery)throw Error('Discovery generation cannot be rebound');
  if(!this.#host||this.#state!=='waiting'||this.#calls.size)throw Error('Bind only an idle waiting host');
  if(!locator||locator.v!==1||typeof locator.alias!=='string'||!/^[a-z2-7]{10}$/.test(locator.alias)||!validId(locator.sessionId)||locator.hostId!==this.#endpointId||Object.keys(locator).sort().join(',')!=='alias,hostId,sessionId,v')throw Error('Directory locator does not match host');
  this.#roomId=locator.sessionId;
  return encodeManualInvitation({id:this.#endpointId,token:this.#token,roomId:this.#roomId});
 }
 async bindDiscovery(locator){
  if(!this.#discovery||!this.#host||this.#state!=='waiting'||this.#calls.size)throw Error('Bind only an idle discovery host');
  if(!locator||locator.v!==1||typeof locator.alias!=='string'||!/^[a-z2-7]{10}$/.test(locator.alias)||!validId(locator.sessionId)||locator.hostId!==this.#endpointId||Object.keys(locator).sort().join(',')!=='alias,hostId,sessionId,v')throw Error('Directory locator does not match host');
  const bound=Object.freeze({...locator});
  this.#set('binding');
  try{
   await this.#call('bind-discovery',[bound.sessionId]);
   if(this.#state!=='binding')throw Error('Session changed during binding');
   this.#roomId=bound.sessionId;this.#set('waiting');return bound;
  }catch(error){this.close();throw error;}
 }
 async proveDirectory(challenge,request,expectedOrigin){
  const origin=new URL(expectedOrigin);
  if(origin.protocol!=='https:'||origin.origin!==expectedOrigin)throw Error('Invalid directory origin');
  if(!challenge||challenge.audience!==expectedOrigin||challenge.actorId!==this.#endpointId||!validId(challenge.challenge)||!validId(challenge.requestHash))throw Error('Directory challenge mismatch');
  const nonce=challenge.challenge,expectedHash=challenge.requestHash;
  const digest=await directoryRequestHash(request);
  if(digest!==expectedHash)throw Error('Directory operation mismatch');
  return this.#call('directory-proof',[expectedOrigin,nonce,digest]);
 }
 #event({type,value}){
  if(type==='pending'&&this.#host){
   const p=JSON.parse(value);
   if(this.#state!=='waiting'||!validId(p.peerId)||typeof p.requestId!=='string'||!/^\d+$/.test(p.requestId))throw Error('Invalid pending request');
   this.#pending={requestId:p.requestId,peerId:p.peerId,roomId:this.#roomId};this.#set('pending');return;
  }
  if(type==='waiting'&&this.#host){this.#pending=undefined;this.#set('waiting');return;}
  if(type==='connected'){
   if(!validId(value))throw Error('Invalid endpoint');
   if(!this.#host){this.#set('awaiting-approval');return;}
   if(this.#state!=='approving'||value!==this.#pending?.peerId)throw Error('Unexpected connection');
   return;
  }
  if(type==='message'){
   const f=JSON.parse(value);
   if(!f||f.v!==2||f.roomId!==this.#roomId||!validId(f.sessionId))throw Error('Invalid message');
   if(!this.#host&&this.#state==='awaiting-approval'&&f.type==='accepted'&&Object.keys(f).sort().join(',')==='roomId,sessionId,type,v'){
    this.#generation=f.sessionId;this.#set('approved');return;
   }
   if(this.#state!=='approved'||f.type!=='data'||f.sessionId!==this.#generation||Object.keys(f).sort().join(',')!=='roomId,sessionId,text,type,v'||typeof f.text!=='string'||!f.text.length)throw Error('Unapproved message');
   this.#emit('message',f.text);return;
  }
  if(type==='disconnected'||type==='closed')this.close();
 }
 async decide(expected,accept){
  if(this.#state!=='pending'||!expected||expected.requestId!==this.#pending?.requestId||expected.peerId!==this.#pending?.peerId||expected.roomId!==this.#roomId)throw Error('Pending peer changed');
  this.#set(accept?'approving':'rejecting');
  try{
   await this.#call(accept?'approve':'reject',[expected.requestId,expected.peerId]);
   if(this.#state==='closed')throw Error('Session closed');
   if(accept){
    // Generated only AFTER approval: buffered pre-approval data cannot know it.
    this.#generation=random();this.#pending=undefined;this.#set('approved');
    await this.#call('send',[JSON.stringify({v:2,type:'accepted',roomId:this.#roomId,sessionId:this.#generation})]);
   }
  }catch(error){this.close();throw error;}
 }
 async send(text){
  if(this.#state!=='approved')throw Error('Host approval required');
  const frame=JSON.stringify({v:2,type:'data',roomId:this.#roomId,sessionId:this.#generation,text});
  if(typeof text!=='string'||!text.length||new TextEncoder().encode(frame).length>4096)throw Error('Message is too large');
  try{await this.#call('send',[frame]);}catch(error){this.close();throw error;}
 }
 #call(op,args=[]){
  if(!this.#worker||this.#state==='closed')return Promise.reject(Error('Session closed'));
  if(this.#calls.size)return Promise.reject(Error('Wait for the current operation'));
  const id=++this.#serial;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.#calls.delete(id);reject(Error('Transport timed out'));this.close();},30000);
   this.#calls.set(id,{resolve,reject,timer});
   try{this.#worker.postMessage({id,op,args});}catch(error){clearTimeout(timer);this.#calls.delete(id);reject(error);}
  });
 }
 #fail(reason){this.#emit('error',reason);this.close();}
 close({force=false}={}){
  if(this.#state==='closed')return this.#closing;
  const worker=this.#worker,graceful=worker&&!force&&!this.#calls.size;
  this.#worker=undefined;this.#pending=this.#generation=this.#roomId=this.#endpointId=this.#token=undefined;this.#revoke();
  for(const call of this.#calls.values()){clearTimeout(call.timer);call.reject(Error('Session closed'));}this.#calls.clear();
   // A closed-state listener may synchronously call close again (the pairing
   // coordinator does). Publish the pending completion before notifying it.
   let resolveClose;this.#closing=new Promise(resolve=>{resolveClose=resolve;});
   this.#set('closed');
   if(!graceful){worker?.terminate();resolveClose();return this.#closing;}
   const id=++this.#serial;let timer;
   const finish=()=>{clearTimeout(timer);worker.terminate();resolveClose();};
   worker.onmessage=({data})=>{if(data.id===id)finish();};worker.onerror=finish;
   timer=setTimeout(finish,1500);try{worker.postMessage({id,op:'close'});}catch{finish();}
   return this.#closing;
 }
}
