import {parseInvitation} from '../../public/transport.js';
export const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseManualInvitation(text){
 if(typeof text!=='string'||text.length>768)throw Error('Invalid approval invitation');
 const value=JSON.parse(text);
 if(!value||value.v!==2||Object.keys(value).sort().join(',')!=='id,roomId,token,v'||!validId(value.roomId))throw Error('Use a fresh version 2 approval invitation');
 parseInvitation(JSON.stringify({v:1,id:value.id,token:value.token}));
 return value;
}
export function encodeManualInvitation({id,token,roomId}){
 const text=JSON.stringify({v:2,id,token,roomId});parseManualInvitation(text);return text;
}
