// This document's meta CSP is inherited by the blob worker even on static hosts.
let attached=false,worker,port,url;
const revoke=()=>{if(url){URL.revokeObjectURL(url);url=undefined;}};
const stop=()=>{worker?.terminate();worker=undefined;revoke();port?.close();port=undefined;};
addEventListener('pagehide',stop);
addEventListener('message',event=>{
 if(attached||parent===self||event.source!==parent||event.origin!==location.origin||event.data?.type!=='attach-mailbox-v1'||event.ports.length!==1)return;
 attached=true;port=event.ports[0];
 try{
  url=URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL('./mailbox-worker.mjs',import.meta.url).href)};`],{type:'text/javascript'}));
  worker=new Worker(url,{type:'module',credentials:'omit'});
  worker.onmessage=({data})=>{revoke();port?.postMessage({type:'message',data});};
  worker.onerror=event=>{event.preventDefault();port?.postMessage({type:'error'});stop();};
  port.onmessage=({data})=>{
   if(data?.type==='stop'){stop();return;}
   if(data?.type!=='call'||!worker)return;
   try{worker.postMessage(data.data);}catch{port?.postMessage({type:'error'});stop();}
  };
  port.postMessage({type:'ready'});
 }catch{port?.postMessage({type:'error'});stop();}
});
