// Compatibility boundary for the existing room/RPC engine. No PeerJS or WebRTC.
import {createIrohChannel} from './iroh-channel.js';
import {createIrohFrame} from './iroh-frame-client.js';
import {requestPeerApproval} from './connection-ui.js';
import {normalizeCompactCode} from '../public/vendor/iroh-pairing/runtime/9335247ccc0c2f5535fdbe69/prototype/compact-code.mjs';
export function normalizeInvitation(input){
 let value=String(input).trim();
 if(/^https?:\/\//i.test(value))value=new URLSearchParams(new URL(value).hash.slice(1)).get('join')||'';
 try{return normalizeCompactCode(value);}catch{throw Error('Enter the 10-character invitation code or paste its link.');}
}
const validWelcome=value=>value&&Object.keys(value).sort().join(',')==='id,secret,type'&&value.type==='meadow-welcome-v1'&&/^[a-f0-9]{18}$/.test(value.id)&&/^[a-f0-9]{64}$/.test(value.secret);
const notify=message=>{for(const id of ['room-progress','live-message']){const element=globalThis.document?.getElementById(id);if(element)element.textContent=message;}};
// Creating/joining a room authorizes the connection; no additional consent popup.
export async function createDirectPeer({id,invitation,onConnection=()=>{},onInvitation=()=>{},onError=()=>{},frameFactory=createIrohFrame,requestConsent=()=>true,approvePeer=requestPeerApproval,status=notify,signal}={}){
 if(signal?.aborted)throw Error('Connection cancelled.');
 if(!await requestConsent())throw Error('Connection cancelled.');
 let bridge,channel,approval,destroyed=false,creating=false,renew=false,spent=false,code='',attempt=0;
 let readyResolve,readyReject,readyTimer;
 const host=!!id;
 function clearReady(){clearTimeout(readyTimer);readyResolve=readyReject=undefined;}
 function failure(error){if(!destroyed){onError(error);status(error.message);}}
 function ended(){
  approval?.abort();
  const error=Error('Connection ended. Ask the host for a fresh invitation to resume.');
  readyReject?.(error);clearReady();channel?.close(error);channel=undefined;
  if(host&&!destroyed){renew=true;code='';onInvitation('');status('Connection ended. A fresh invitation will appear for reconnecting.');}
 }
 function makeChannel(){
  const owner=bridge;
  const c=createIrohChannel({sendText:text=>owner.call('send',text),closeTransport:()=>{owner.close();}});
  c.onClose(error=>{if(c===channel){readyReject?.(error);clearReady();}});
  channel=c;return c;
 }
 async function approvedHost(current){
  if(destroyed||current!==attempt)return;
  const c=makeChannel();onConnection(c);
  await c.send({type:'meadow-welcome-v1',id:invitation.id,secret:invitation.secret});
 }
 async function event(detail,current){
  if(destroyed||current!==attempt)return;
  if(detail.type==='code'){code=detail.value;onInvitation(code);}
  if(detail.type==='message'){channel?.receive(detail.value);return;}
  if(detail.type==='error')failure(Error(detail.value));
  if(detail.type!=='state')return;
  if(detail.value==='pending'&&host){
   if(approval)return;const decision=approval=new AbortController();
   try{const accept=await approvePeer({signal:decision.signal});if(destroyed||current!==attempt||decision.signal.aborted)return;await bridge.call('decide',!!accept);if(accept)await approvedHost(current);}
   catch(error){failure(error);bridge?.close();}finally{if(approval===decision)approval=undefined;}return;
  }
  if(detail.value==='awaiting-approval')status('Waiting for the host to accept your connection…');
  if(detail.value==='approved'&&!host){
   if(!channel){const c=makeChannel();const off=c.onMessage(value=>{
    if(!validWelcome(value)){c.close(Error('Invalid room connection metadata.'));return;}
    off();c.invitation={id:value.id,secret:value.secret};readyResolve?.(c);clearReady();
   });}
  }
  if(detail.value==='closing'||detail.value==='closed')ended();
 }
 async function start(){
  if(creating||destroyed)return;creating=true;renew=false;const current=++attempt;
  try{
   const old=bridge;bridge=undefined;await old?.close();
   if(destroyed)throw Error('Connection cancelled.');
   bridge=await frameFactory({signal,onEvent:detail=>{event(detail,current).catch(failure);}});
   if(destroyed){await bridge.close();throw Error('Connection cancelled.');}
   if(host){const created=await bridge.call('create');if(destroyed||current!==attempt){await bridge.close();throw Error('Connection cancelled.');}code=normalizeInvitation(created);onInvitation(code);status('Share this invitation privately. You will approve the joining player.');}
  }finally{creating=false;}
 }
 function close(){if(destroyed)return;destroyed=true;renew=false;approval?.abort();readyReject?.(Error('Connection cancelled.'));clearReady();channel?.close();channel=undefined;signal?.removeEventListener('abort',close);return bridge?.close();}
 signal?.addEventListener('abort',close,{once:true});
 try{await start();}catch(error){close();throw error;}
 return {id,get invitationCode(){return code;},
  connect(input){
   if(host||destroyed||spent)throw Error('Use a fresh invitation to reconnect.');
   const value=normalizeInvitation(input);spent=true;
   const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;readyTimer=setTimeout(()=>{reject(Error('Host approval timed out. Ask for a fresh invitation.'));close();},150000);});ready.catch(()=>{});
   bridge.call('join',value).catch(error=>{readyReject?.(error);close();});
   return {ready,get invitation(){return channel?.invitation;},send:value=>channel.send(value),onMessage:listener=>channel.onMessage(listener),onClose:listener=>channel.onClose(listener),close:()=>channel?.close()};
  },
  reconnectSignaling(){if(host&&renew&&!creating&&!destroyed)start().catch(failure);},close,
 };
}
