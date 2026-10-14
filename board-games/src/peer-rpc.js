// Bounded, ordered framing over a reliable WebRTC data channel.
export function createPeerRPC(channel, handle = async () => { throw new Error('Unknown request.'); }, timeoutMs = 12000) {
  const pending = new Map(), parts = new Map();
  let sequence=0, closed=false;
  const prefix=crypto.randomUUID();
  function send(message) {
    const text=JSON.stringify(message), id=`${prefix}:${++sequence}`;
    if(text.length>3000000)throw new Error('Room synchronization is too large.');
    const total=Math.ceil(text.length/6000);
    for(let index=0;index<total;index++)channel.send({id,index,total,part:text.slice(index*6000,(index+1)*6000)});
  }
  const off=channel.onMessage(frame=>{
    if(closed)return;
    if(!frame || typeof frame.id!=='string' || frame.id.length>100 || !Number.isInteger(frame.index) || !Number.isInteger(frame.total) || frame.total<1 || frame.total>500 || typeof frame.part!=='string' || frame.part.length>6000){channel.close(new Error('Invalid synchronization frame.'));return;}
    let item=parts.get(frame.id);
    if(!item){if(frame.index!==0 || parts.size>=16){channel.close();return;}item={text:'',next:0,total:frame.total};parts.set(frame.id,item);}
    if(frame.index!==item.next || frame.total!==item.total){channel.close();return;}
    item.text+=frame.part;item.next++;
    if(item.next!==item.total)return;
    parts.delete(frame.id);
    let message;
    try{message=JSON.parse(item.text);}catch{channel.close();return;}
    if(!message || typeof message.id!=='string'){channel.close();return;}
    if(message.kind==='response') {
      const request=pending.get(message.id);if(!request)return;
      pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(Object.assign(new Error(message.error.message),{status:message.error.status}));else request.resolve(message.value);
    } else if(message.kind==='request') {
      Promise.resolve().then(()=>handle(message.method,message.value)).then(
        value=>{if(!closed)send({kind:'response',id:message.id,value});},
        error=>{if(!closed)send({kind:'response',id:message.id,error:{message:error.message||'Peer request failed.',status:error.status||400}});}
      ).catch(()=>channel.close());
    } else channel.close();
  });
  const end=()=>{if(closed)return;closed=true;off();parts.clear();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Peer connection interrupted.'));}pending.clear();};
  channel.onClose(end);
  return {
    request(method,value) {
      if(closed)return Promise.reject(new Error('Peer connection interrupted.'));
      if(pending.size>=16)return Promise.reject(new Error('Too many pending peer requests.'));
      return new Promise((resolve,reject)=>{
        const id=`request-${prefix}:${++sequence}`;
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Peer did not respond.'));},timeoutMs);
        pending.set(id,{resolve,reject,timer});
        try{send({kind:'request',id,method,value});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
      });
    },
    close(){end();channel.close();},
  };
}
