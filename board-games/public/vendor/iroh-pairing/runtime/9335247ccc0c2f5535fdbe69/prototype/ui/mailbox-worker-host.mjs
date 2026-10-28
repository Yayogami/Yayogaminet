// Worker-shaped handle. A single hidden same-origin frame supplies a narrow CSP;
// this is policy inheritance, not isolation from compromised same-origin scripts.
export class MailboxWorkerHost {
 #frame;#port;#remote;#ready=false;#closed=false;#queued;
 onmessage=null;onerror=null;
 constructor(){
  const channel=new MessageChannel();this.#port=channel.port1;this.#remote=channel.port2;
  const frame=this.#frame=document.createElement('iframe');frame.hidden=true;
  frame.title='Mailbox connection';frame.referrerPolicy='no-referrer';
  frame.src=new URL('./mailbox-frame.html',import.meta.url).href;
  this.#port.onmessage=({data})=>{
   if(this.#closed)return;
   if(data?.type==='ready'){
    if(this.#ready){this.#fail();return;}this.#ready=true;
    if(this.#queued){const queued=this.#queued;this.#queued=undefined;this.postMessage(queued);}
   }else if(data?.type==='message'&&this.#ready)this.onmessage?.({data:data.data});
   else this.#fail();
  };
  this.#port.onmessageerror=()=>this.#fail();
  let loaded=false;
  frame.onload=()=>{
   if(this.#closed)return;if(loaded){this.#fail();return;}loaded=true;
   try{frame.contentWindow.postMessage({type:'attach-mailbox-v1'},location.origin,[this.#remote]);this.#remote=undefined;}catch{this.#fail();}
  };
  frame.onerror=()=>this.#fail();
  try{document.body.append(frame);}catch(error){this.terminate();throw error;}
 }
 postMessage(data){
  if(this.#closed)throw Error('Mailbox worker closed');
  if(!this.#ready){if(this.#queued)throw Error('Mailbox bootstrap busy');this.#queued=data;return;}
  this.#port.postMessage({type:'call',data});
 }
 #fail(){if(this.#closed)return;this.terminate();this.onerror?.({preventDefault(){}});}
 terminate(){
  if(this.#closed)return;this.#closed=true;this.#queued=undefined;
  try{this.#port?.postMessage({type:'stop'});}catch{}
  this.#port?.close();this.#remote?.close();this.#port=this.#remote=undefined;
  if(this.#frame){this.#frame.onload=this.#frame.onerror=null;this.#frame.remove();this.#frame=undefined;}
 }
}
