import {cleanupTicket,peerCleanupTicket,retireMailboxClaims} from '../mailbox-cleanup.mjs';
import {MailboxWorkerHost} from './mailbox-worker-host.mjs';
export class MailboxClient extends EventTarget {
 #worker;#call;#serial=0;#closed=false;#closing;#own;#peer;#dirty=false;#retryRecords;#retryUsed=false;#retrying;#expiry;#known=false;#retired=false;#watchdog;
 constructor({workerFactory=()=>new MailboxWorkerHost(),cleanup=retireMailboxClaims,watchdogMs=30000}={}){
  super();this.cleanup=cleanup;this.#worker=workerFactory();
  const alive=()=>{clearTimeout(this.#watchdog);this.#watchdog=setTimeout(()=>this.#lost(),watchdogMs);this.#watchdog.unref?.();};alive();
  this.#worker.onmessage=({data})=>{
   if(this.#closed)return;
   alive();if(data.event==='alive')return;
   if(data.event==='receipt'){
    this.#dirty=!!data.value?.dirty;
    try{const {side,nameplate,mailbox}=data.value;this.#own=cleanupTicket({side,nameplate,mailbox});}catch{}return;
   }
   if(data.event==='pairing'){
    if(this.#call&&!this.#call.timer)this.#call.timer=setTimeout(()=>this.#lost(),30000);
    this.dispatchEvent(new Event('pairing'));return;
   }
   if(data.event==='lost'){this.#lost();return;}
   if(!this.#call||data.id!==this.#call.id)return;
   const call=this.#call;this.#call=undefined;clearTimeout(call.timer);
   data.error?call.reject(Error('Pairing failed; use a fresh code')):call.resolve(data.result);
  };
  this.#worker.onerror=event=>{event.preventDefault?.();this.#lost();};
 }
 #lost(){if(!this.#closed){this.dispatchEvent(new Event('lost'));this.close();}}
 call(op,value,timeoutMs=30000){
  if(this.#closed||this.#call)return Promise.reject(Error('Mailbox unavailable'));
  const id=++this.#serial;
  return new Promise((resolve,reject)=>{
   this.#call={id,resolve,reject,timer:timeoutMs?setTimeout(()=>{this.#lost();this.close();},timeoutMs):undefined};
   try{this.#worker.postMessage({id,op,value});}catch{this.#lost();this.close();}
  });
 }
 get ticket(){return this.#own?{...this.#own}:null;}
 get canRetryCleanup(){return this.#closed&&!this.#retired&&!this.#retryUsed&&!!this.#retryRecords;}
 setPeerTicket(value){if(this.#closed)throw Error('Session closed');this.#peer=peerCleanupTicket(value,this.#own);}
 close(){
  if(this.#closing)return this.#closing;
  this.#closed=true;clearTimeout(this.#watchdog);this.#worker.terminate();this.#worker=undefined;
  if(this.#call){clearTimeout(this.#call.timer);this.#call.reject(Error('Pairing cancelled'));this.#call=undefined;}
  const records=[this.#own,this.#peer].filter(Boolean),known=!this.#dirty||!!this.#own;this.#known=known;
  this.#own=this.#peer=undefined;
  this.#closing=Promise.resolve().then(()=>this.cleanup(records)).then(result=>known&&result,()=>false).then(confirmed=>{
   this.#retired=confirmed;
   if(!confirmed&&records.length){this.#retryRecords=records;this.#expiry=setTimeout(()=>{this.#retryRecords=undefined;this.dispatchEvent(new Event('cleanup-expired'));},300000);this.#expiry.unref?.();}
   return confirmed;
  });
  return this.#closing;
 }
 retryCleanup(){
  if(!this.#closed)return Promise.resolve(false);
  // Automatic online recovery and a button click share the same bounded attempt.
  if(this.#retrying)return this.#retrying;
  this.#retrying=(async()=>{
   await this.#closing;if(this.#retired)return true;
   if(this.#retryUsed||!this.#retryRecords)return false;
   this.#retryUsed=true;clearTimeout(this.#expiry);const records=this.#retryRecords;this.#retryRecords=undefined;
   try{this.#retired=this.#known&&await this.cleanup(records);return this.#retired;}catch{return false;}
  })();return this.#retrying;
 }
}
