import init,{PrivacyNode} from '../wasm/iroh_browser_proof.js';
import {installRelayPolicy} from '../../public/relay-policy.js';
installRelayPolicy(globalThis,new URL('../wasm/iroh_browser_proof_bg.wasm',import.meta.url));
let node,busy=false;
self.onmessage=async({data:{id,op,args=[]}})=>{
 if(busy){postMessage({id,error:'Operation already in progress'});return;}
 busy=true;
 try{
  let result;
  if(op==='start'){
   if(node)throw Error('Already started');await init();
   const callback=value=>postMessage({event:JSON.parse(value)});
    node=args[2]?await PrivacyNode.start_discovery(args[0],args[1],callback):args[1]?await PrivacyNode.start_manual(args[0],callback):await PrivacyNode.start(args[0],false,callback);
   result=node.endpoint_id();
  }else if(op==='connect')await node.connect(args[0]);
   else if(op==='bind-discovery')node.bind_discovery_room(args[0]);
  else if(op==='approve')node.approve_pending(...args);
  else if(op==='reject')node.reject_pending(...args);
  else if(op==='send')await node.send(args[0]);
  else if(op==='directory-proof')result=Array.from(node.sign_directory_challenge(...args),b=>b.toString(16).padStart(2,'0')).join('');
  else if(op==='close'){await node?.close();node?.free();node=undefined;}
  else throw Error('Unknown operation');
  postMessage({id,result});
 }catch(error){postMessage({id,error:String(error.message||error)});}
 finally{busy=false;}
};
