import {ManualClient} from './manual-client.mjs';
import {MailboxClient} from './mailbox-client.mjs';
import {normalizeCompactCode} from '../compact-code.mjs';
import {cleanupTicket,peerCleanupTicket} from '../mailbox-cleanup.mjs';
import {offerFrame,readOffer,claimFrame,readClaim,boundPending,receiptFrame,readReceipt} from '../mailbox-handoff.mjs';

export function cleanupFrame(locator,ticket){
 readOffer(offerFrame(locator));
 return JSON.stringify({v:1,type:'iroh-cleanup',hostId:locator.hostId,roomId:locator.sessionId,ticket:cleanupTicket(ticket)});
}
export function readCleanupFrame(text,locator,own){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>512)throw Error('Invalid cleanup frame');
 const value=JSON.parse(text);
 if(!value||Object.keys(value).sort().join(',')!=='hostId,roomId,ticket,type,v'||value.v!==1||value.type!=='iroh-cleanup'||value.hostId!==locator.hostId||value.roomId!==locator.sessionId)throw Error('Cleanup generation mismatch');
 return peerCleanupTicket(value.ticket,own);
}

export class PairingSession extends EventTarget {
 #client;#mailbox;#state='idle';#code='';#pending;#closed;#abort=new AbortController();#host=false;#bound=false;#sawPending=false;
 constructor({client=new ManualClient(),mailboxFactory=()=>new MailboxClient()}={}){
  super();this.#client=client;this.mailboxFactory=mailboxFactory;
  client.addEventListener('event',({detail})=>{
   if(this.#abort.signal.aborted)return;
   if(detail.type==='message'&&this.#bound)this.#emit('message',detail.value);
   if(detail.type==='error')this.#fail('The Iroh connection failed. Start a fresh session.');
   if(detail.type==='state'){
    if(detail.value==='pending')this.#sawPending=true;
    if(detail.value==='closed'){
     // Transport startup can close before its promise rejects. Report that
     // failure now; an explicit user cancellation already set the abort signal.
     if(['starting','pairing'].includes(this.#state))this.#fail('The Iroh connection could not start. Start a fresh session.');
     else this.close();
    }
    else if(detail.value==='waiting'&&this.#sawPending)this.#fail('The requester left. Create a fresh code.');
    else if(detail.value==='approved'&&this.#bound)this.#set('approved');
   }
  });
 }
 get state(){return this.#state;}
 get code(){return this.#code;}
 get pending(){return this.#pending?{...this.#pending}:null;}
 get canRetryCleanup(){return !!this.#mailbox?.canRetryCleanup;}
 #emit(type,value){this.dispatchEvent(new CustomEvent('event',{detail:{type,value}}));}
 #set(state){this.#state=state;this.#emit('state',state);}
 #guard(){if(this.#abort.signal.aborted)throw Error('Session cancelled');}
 #prepare(host){
  if(this.#state!=='idle')throw Error('Use a fresh session');
  this.#host=host;this.#set('starting');this.#mailbox=this.mailboxFactory();
  this.#mailbox.addEventListener('lost',()=>this.#fail('The pairing service connection was lost. Start a fresh session.'));
  this.#mailbox.addEventListener('cleanup-expired',()=>this.#emit('cleanup','uncertain'));
  this.#mailbox.addEventListener('pairing',()=>{if(!this.#abort.signal.aborted)this.#set('pairing');});
 }
 async create(){
  this.#prepare(true);
  try{
   const locator=await this.#client.startDiscovery();this.#guard();
   const code=await this.#mailbox.call('create');this.#guard();this.#code=normalizeCompactCode(code);
   this.#emit('code',this.#code);this.#set('waiting');
   this.#hostFlow(locator).catch(()=>{if(!this.#abort.signal.aborted)this.#fail('Pairing failed. Create a fresh code.');});
   return this.#code;
  }catch(error){if(!this.#abort.signal.aborted)this.#fail('Could not create a code. Try a fresh session.');throw error;}
 }
 async #hostFlow(locator){
  await this.#mailbox.call('open',undefined,0);this.#guard();
  await this.#mailbox.call('send',offerFrame(locator));
  const claim=readClaim(await this.#mailbox.call('receive'),locator);this.#guard();
  await this.#waitPending();this.#guard();
  const pending=boundPending(claim,this.#client.pending,this.#client.endpointId);
  await this.#mailbox.call('send',receiptFrame(claim));
  const own=this.#mailbox.ticket;
  await this.#mailbox.call('send',cleanupFrame(locator,own));
  const peer=readCleanupFrame(await this.#mailbox.call('receive'),locator,own);this.#guard();
  this.#mailbox.setPeerTicket(peer);
  // Recheck after the asynchronous exchange so a replaced request cannot pass.
  boundPending(claim,this.#client.pending,this.#client.endpointId);
  this.#pending=pending;this.#bound=true;this.#code='';this.#emit('code','');this.#set('pending');
 }
 async join(input){
  const code=normalizeCompactCode(input);this.#prepare(false);
  try{
   await this.#mailbox.call('join',code);this.#guard();
   const locator=readOffer(await this.#mailbox.call('receive'));this.#guard();
   await this.#client.joinDiscovered(locator);this.#guard();
   await this.#mailbox.call('send',claimFrame(locator,this.#client.endpointId));
   readReceipt(await this.#mailbox.call('receive'),locator,this.#client.endpointId);this.#guard();
   const own=this.#mailbox.ticket;
   this.#mailbox.setPeerTicket(readCleanupFrame(await this.#mailbox.call('receive'),locator,own));
   await this.#mailbox.call('send',cleanupFrame(locator,own));this.#guard();
   this.#bound=true;this.#set(this.#client.state==='approved'?'approved':'awaiting-approval');
  }catch(error){if(!this.#abort.signal.aborted)this.#fail('Pairing failed. Ask for a fresh code.');throw error;}
 }
 #waitPending(){
  if(this.#client.state==='pending')return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);this.#client.removeEventListener('event',event);this.#abort.signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
   const event=({detail})=>{if(detail.type==='state'&&detail.value==='pending')finish();};
   const cancel=()=>finish(Error('Session cancelled'));
   const timer=setTimeout(()=>finish(Error('Requester did not arrive')),30000);
   this.#client.addEventListener('event',event);this.#abort.signal.addEventListener('abort',cancel,{once:true});
   if(this.#abort.signal.aborted)cancel();
  });
 }
 async decide(accept){
  if(!this.#host||!this.#bound||this.#state!=='pending')throw Error('No verified requester');
  if(!accept){await this.close();return;}
  try{await this.#client.decide(this.#pending,true);this.#guard();this.#pending=undefined;this.#set('approved');}
  catch(error){this.#fail('Approval failed. Create a fresh code.');throw error;}
 }
 async send(text){
  if(this.#state!=='approved')throw Error('Host approval required');
  return this.#client.send(text);
 }
 #fail(message){if(!this.#abort.signal.aborted){this.#emit('error',message);this.close();}}
 async retryCleanup(){
  if(!this.#closed)return;
  await this.#closed;
  const confirmed=await(this.#mailbox?.retryCleanup()??true);
  this.#emit('cleanup',confirmed?'confirmed':'uncertain');
 }
 close(){
  if(this.#closed)return this.#closed;
  this.#abort.abort();this.#pending=undefined;this.#code='';this.#bound=false;this.#emit('code','');this.#set('closing');
  // Terminate the transport before releasing either claim. Cancellation never
  // waits for a borrowed WASM handle or an unfinished PAKE receive operation.
  const ending=this.#client.close({force:true});
  this.#closed=Promise.resolve(ending).then(()=>this.#mailbox?.close()??true).then(confirmed=>{
   this.#emit('cleanup',confirmed?'confirmed':'uncertain');this.#set('closed');return confirmed;
  });
  return this.#closed;
 }
}
