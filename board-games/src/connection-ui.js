// Host admission stays explicit; the game artwork is applied by main.js.
export function requestPeerApproval({signal}={}) {
  const dialog=globalThis.document?.getElementById('peer-approval-dialog');
  if(!dialog||dialog.open||signal?.aborted)return Promise.resolve(false);
  return new Promise(resolve=>{
    let settled=false;
    const finish=accepted=>{
      if(settled)return;settled=true;
      dialog.removeEventListener('close',closed);
      signal?.removeEventListener('abort',aborted);
      globalThis.removeEventListener('pagehide',aborted);
      if(dialog.open)dialog.close();
      resolve(accepted);
    };
    // close events are queued. An earlier cancellation must not dismiss a
    // newer request that has already reopened this same dialog.
    const closed=()=>{if(!dialog.open)finish(dialog.returnValue==='accept');};
    const aborted=()=>finish(false);
    dialog.returnValue='';
    dialog.addEventListener('close',closed);
    signal?.addEventListener('abort',aborted,{once:true});
    globalThis.addEventListener('pagehide',aborted,{once:true});
    try{dialog.showModal();}catch{finish(false);}
  });
}
