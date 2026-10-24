import {parseRoomAlias} from './room-credentials.mjs';
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fields={reserve:['op','alias'],request:['op','alias','sessionId','requestId'],pending:['op','alias','sessionId'],approve:['op','alias','sessionId','requestId','peerId'],reject:['op','alias','sessionId','requestId'],heartbeat:['op','alias','sessionId'],leave:['op','alias','sessionId']};
export function canonicalRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.op!=='string'||!Object.hasOwn(fields,input.op))throw Error('Invalid directory operation');
 const keys=[...fields[input.op]].sort();
 if(Object.keys(input).sort().join(',')!==keys.join(','))throw Error('Unexpected request fields');
 const result={};for(const key of keys){
  const value=input[key];
  if(key==='alias'){result[key]=parseRoomAlias(value);continue;}
  if(key!=='op'&&!id(value))throw Error('Invalid request identity');
  result[key]=value;
 }
 return JSON.stringify(result);
}
export async function directoryRequestHash(request){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalRequest(request)))));}
export function directoryProofBytes({audience,actorId,challenge,requestHash}){
 if(typeof audience!=='string'||!/^[!-~]{1,200}$/.test(audience)||![actorId,challenge,requestHash].every(id))throw Error('Invalid proof fields');
 return new TextEncoder().encode(`iroh-room-directory-v1\n${audience}\n${actorId}\n${challenge}\n${requestHash}`);
}
