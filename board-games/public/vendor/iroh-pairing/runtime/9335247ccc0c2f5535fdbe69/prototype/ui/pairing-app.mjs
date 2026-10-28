import {PairingSession} from './pairing-session.mjs';
const $=id=>document.getElementById(id);
const labels={idle:'Idle',starting:'Starting session',waiting:'Waiting for partner',pairing:'Verifying pairing',pending:'Requester pending','awaiting-approval':'Waiting for host approval',approved:'Approved — connected',closing:'Ending session',closed:'Session ended'};
let session,busy=false;
function clear(){ $('code').value=$('message').value=$('peer').value='';$('messages').replaceChildren();$('consent').checked=false; }
function render(){
 const state=session?.state??'idle',active=!['idle','closed'].includes(state);
 $('state').textContent=labels[state];$('create').disabled=$('join').disabled=$('consent').disabled=active||busy;
 $('code').readOnly=active;$('stop').disabled=!active||state==='closing';$('copy').disabled=!$('code').value||!active;
 $('approval').hidden=state!=='pending';$('peer').value=session?.pending?.peerId??'';
 $('accept').disabled=$('reject').disabled=busy;$('send').disabled=$('message').disabled=state!=='approved'||busy;
 $('retry-cleanup').hidden=state!=='closed'||!session?.canRetryCleanup;$('retry-cleanup').disabled=busy;
}
function message(who,text){const li=document.createElement('li'),label=document.createElement('small');label.textContent=who;li.append(label,document.createTextNode(text));$('messages').append(li);while($('messages').children.length>100)$('messages').firstChild.remove();}
// Start validation may fail before replacing an ended session. Show that error,
// while still suppressing late failures from a new session the user cancelled.
async function run(action,starting=false){if(busy)return;const previous=session;busy=true;$('error').textContent='';render();try{await action();}catch(error){if((starting&&session===previous)||!['closing','closed'].includes(session?.state))$('error').textContent=error.message;}finally{busy=false;render();}}
async function start(join){
 if(window.top!==window.self)throw Error('Open this page in its own tab');
 if(!$('consent').checked)throw Error('Allow both service connections first');
 const code=$('code').value;
 const current=session=new PairingSession();$('cleanup').textContent='';
 current.addEventListener('event',({detail})=>{
  if(current!==session)return;
  if(detail.type==='code')$('code').value=detail.value;
  if(detail.type==='message')message('Peer',detail.value);
  if(detail.type==='error')$('error').textContent=detail.value;
  if(detail.type==='state'&&['closing','closed'].includes(detail.value))clear();
  if(detail.type==='cleanup')$('cleanup').textContent=detail.value==='confirmed'?'Mailbox cleanup confirmed.':'Connection ended. Mailbox cleanup could not be confirmed; the server may retain the code until expiry.';
  render();
 });
 if(join){$('code').value='';await current.join(code);}else await current.create();
}
$('create').onclick=()=>run(()=>start(false),true);$('join').onclick=()=>run(()=>start(true),true);
$('accept').onclick=()=>run(()=>session.decide(true));$('reject').onclick=()=>run(()=>session.decide(false));
$('stop').onclick=()=>{session?.close();clear();render();};
$('retry-cleanup').onclick=()=>run(()=>session?.retryCleanup());
$('copy').onclick=()=>run(()=>navigator.clipboard.writeText($('code').value));
$('send-form').onsubmit=event=>{event.preventDefault();const current=session,text=$('message').value;return run(async()=>{
 try{await current.send(text);if(current===session&&current.state==='approved'){message('You · acknowledged',text);$('message').value='';}}
 catch{if(current===session)$('error').textContent=current.state==='approved'?'Message not sent. Enter shorter, non-empty text and try again.':'Delivery unknown. The session ended; the message was not resent.';}
});};
window.addEventListener('offline',()=>{if(session&&!['closed','idle'].includes(session.state)){$('error').textContent='Network connection lost. Start a fresh session when you are online.';session.close();}});
window.addEventListener('online',()=>{if(session&&['closed','closing'].includes(session.state))session.retryCleanup();});
window.addEventListener('pagehide',()=>{session?.close();clear();});render();
