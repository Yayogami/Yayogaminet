// Isolated policy document. Transport is pinned to the reviewed compatible privacy build.
import {PairingSession} from '../public/vendor/iroh-pairing/runtime/9335247ccc0c2f5535fdbe69/prototype/ui/pairing-session.mjs';
let port,session,heartbeat,busy=false;
addEventListener('message',event=>{
 if(port||event.source!==parent||event.origin!==location.origin||event.data?.type!=='meadow-iroh-port'||event.ports.length!==1)return;
 port=event.ports[0];session=new PairingSession();
 session.addEventListener('event',({detail})=>port.postMessage({event:detail}));
 port.onmessage=async({data})=>{
  if(!data||!Number.isSafeInteger(data.id)||!['create','join','decide','send','close'].includes(data.op))return;
  if(data.op!=='close'&&busy){port.postMessage({id:data.id,error:'Transport operation in progress'});return;}
  if(data.op!=='close')busy=true;
  try{
   let value;
   if(data.op==='create')value=await session.create();
   if(data.op==='join')value=await session.join(data.value);
   if(data.op==='decide')value=await session.decide(data.value===true);
   if(data.op==='send')value=await session.send(data.value);
   if(data.op==='close')value=await session.close();
   port.postMessage({id:data.id,value});
  }catch(error){port.postMessage({id:data.id,error:String(error.message)});}
  finally{if(data.op!=='close')busy=false;}
 };
 port.start();port.postMessage({ready:true});heartbeat=setInterval(()=>port.postMessage({heartbeat:true}),2000);
});
addEventListener('pagehide',()=>{clearInterval(heartbeat);session?.close();port?.close();},{once:true});
