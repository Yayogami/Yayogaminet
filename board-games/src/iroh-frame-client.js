// One-port policy bridge; the game page needs no WebRTC or relay connection.
export async function createIrohFrame({onEvent=()=>{},signal}={}){
 if(signal?.aborted)throw Error('Connection cancelled.');
 const frame=document.createElement('iframe');frame.hidden=true;frame.title='Private connection';frame.referrerPolicy='no-referrer';
 frame.src=new URL('./iroh-bridge.html',import.meta.url).href;
 const {port1:port,port2}=new MessageChannel(),calls=new Map();let serial=0,closed=false,closing,lastBeat=Date.now(),watchdog,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const readyTimer=setTimeout(()=>dispose(Error('Connection worker could not start.')),15000);
 function dispose(error=Error('Connection ended.')){
  if(closed)return;closed=true;clearTimeout(readyTimer);clearInterval(watchdog);signal?.removeEventListener('abort',abort);
  readyReject(error);for(const task of calls.values()){clearTimeout(task.timer);task.reject(error);}calls.clear();port.close();frame.remove();
 }
 function call(op,value){
  if(closed)return Promise.reject(Error('Connection ended.'));
  const id=++serial;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{calls.delete(id);reject(Error('Connection operation timed out.'));if(op!=='close')close();},op==='close'?20000:45000);calls.set(id,{resolve,reject,timer});port.postMessage({id,op,value});});
 }
 function close(){if(closing)return closing;if(closed)return Promise.resolve();closing=call('close').catch(()=>false).finally(()=>dispose());return closing;}
 function abort(){close();}
 signal?.addEventListener('abort',abort,{once:true});
 port.onmessage=({data})=>{
  if(closed)return;
  if(data.ready){clearTimeout(readyTimer);readyResolve();return;}
  if(data.heartbeat){lastBeat=Date.now();return;}
  if(data.event){onEvent(data.event);return;}
  const task=calls.get(data.id);if(task){calls.delete(data.id);clearTimeout(task.timer);data.error?task.reject(Error(data.error)):task.resolve(data.value);}
 };
 // WebKit can attribute a message sent during an iframe load callback to the
 // loaded child. Send from a parent task so the child's strict sender check holds.
 port.start();frame.addEventListener('load',()=>setTimeout(()=>{if(!closed)frame.contentWindow.postMessage({type:'meadow-iroh-port'},location.origin,[port2]);},0),{once:true});
 document.body.append(frame);
 watchdog=setInterval(()=>{if(Date.now()-lastBeat>30000){onEvent({type:'error',value:'Connection worker stopped responding.'});dispose();onEvent({type:'state',value:'closed'});}},5000);
 try{await ready;if(signal?.aborted)throw Error('Connection cancelled.');return {call,close};}catch(error){dispose(error);throw error;}
}
