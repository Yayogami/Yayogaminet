import { createDirectPeer, normalizeInvitation } from './direct-peer.js';
import { createPeerRPC } from './peer-rpc.js';
import { createRoomService } from './room-engine.js';
import { browserSecurity } from './room-security.js';
import { peerProof } from './peer-auth.js';
import { verifyPeerRoom } from './peer-verifier.js';

const SESSION='meadow-p2p-session-v1';
const recordKey=session=>`meadow-p2p-room-v1:${session.id}:${session.role}`;
export async function parseInvitation(code) {
  // The alias discovers a fresh, host-approved channel. Never derive a room
  // credential or identity from this recyclable code.
  return {inviteCode:normalizeInvitation(code)};
}
export function createPeerRooms({peerFactory=createDirectPeer, storage=globalThis.localStorage, tabStorage=globalThis.sessionStorage, now=Date.now}={}) {
  let active=null;
  const saveSession=session=>tabStorage.setItem(SESSION,JSON.stringify(session));
  const savedSession=()=>{try{return JSON.parse(tabStorage.getItem(SESSION));}catch{return null;}};
  function persist(a) {
    const value={session:a.session,last:a.last,lastAt:a.lastAt,outage:a.outage,guestKey:a.guestKey};
    if(a.core)value.snapshot=a.core.snapshot();
    try { storage.setItem(recordKey(a.session),JSON.stringify(value)); }
    catch {a.failure=new Error('Browser storage is unavailable. Play is stopped to protect the saved match.');a.peer?.close();throw a.failure;}
  }
  function stop() { if(active){active.closed=true;active.abort?.abort();clearInterval(active.timer);active.rpc?.close();active.peer?.close();active=null;} }
  function packet(a,room) {
    const saved=a.core.snapshot().rooms[0];
    const moves=saved.history.slice(1).map(entry=>entry.position.lastMove);
    if(saved.position.ply)moves.push(saved.position.lastMove);
    return {room,moves};
  }
  function localRead(a) {a.peer.reconnectSignaling();const room=a.core.read(a.session.id,a.session.token);a.last=room;a.lastAt=now();persist(a);return room;}
  async function startHost(session, snapshot=null, guestKey=null) {
    const a={session,core:createRoomService({savedState:snapshot,now,maxRooms:1}),guestKey,closed:false,abort:new AbortController()};
    active=a;
    try { a.peer=await peerFactory({id:`meadow-${session.id}`,invitation:{id:session.id,secret:session.secret},signal:a.abort.signal,
      onInvitation:code=>{if(a.closed)return;session.inviteCode=code;if(a.last){persist(a);saveSession(session);}},onConnection:channel=>{
      let authenticated=false;
      const rpc=createPeerRPC(channel,async(method,value)=>{
        if(a.closed)throw new Error('Room is closed.');
        if(a.failure)throw a.failure;
        if(method==='hello') {
          if(authenticated)throw new Error('Handshake already completed.');
          const expected=await peerProof(session.secret,session.id,value?.nonce,'guest');
          if(!browserSecurity.equalToken(expected,value?.proof))throw new Error('Invalid invitation.');
          authenticated=true;
          return {proof:await peerProof(session.secret,session.id,value.nonce,'host')};
        }
        if(!authenticated)throw new Error('Invitation handshake required.');
        let result;
        if(method==='join') {
          if(!/^[a-f0-9]{64}$/.test(value?.guestKey))throw new Error('Invalid player identity.');
          if(a.guestKey===value.guestKey) {
            const seat=a.core.snapshot().rooms[0].players[1];
            result={token:seat.token,room:a.core.read(session.id,seat.token)};
          } else {
            result=a.core.join(session.id);a.guestKey=value.guestKey;
          }
        } else {
          // Even an invitation holder must not act using the creator's seat.
          const guest=a.core.snapshot().rooms[0].players[1];
          if(!guest || !browserSecurity.equalToken(guest.token,value?.token))throw new Error('Guest access required.');
          if(method==='read')result={room:value.report ? a.core.reconcilePeerReturn(session.id,value.token,value.report) : a.core.read(session.id,value.token)};
          else if(method==='action')result={room:a.core.action(session.id,value.token,value.action)};
          else throw new Error('Unknown peer request.');
        }
        persist(a);
        return {...packet(a,result.room),...(result.token?{token:result.token}:{})};
      });
      channel.onClose(()=>rpc.close());
    }}); } catch(error) {a.closed=true;if(active===a)active=null;throw error;}
    if(a.closed){a.peer.close();throw new Error('Room was closed.');}
    a.timer=setInterval(()=>{
      if(a.closed)return;
      try{a.core.tick();persist(a);a.peer.reconnectSignaling();}catch(error){a.failure=error;clearInterval(a.timer);a.peer.close();}
    },1000);
    return a;
  }
  async function ensureGuest(a) {
    if(a.rpc)return a.rpc;
    if(a.connecting)return a.connecting;
    a.connecting=(async()=>{
      if(!a.peer)a.peer=await peerFactory({signal:a.abort.signal,onConnection:channel=>channel.close()});
      if(a.closed){a.peer.close();throw new Error('Room was closed.');}
      a.peer.reconnectSignaling();
      const channel=a.peer.connect(a.session.inviteCode);
      await channel.ready;
      const invitation=channel.invitation;
      if(!invitation||!/^[a-f0-9]{18}$/.test(invitation.id)||!/^[a-f0-9]{64}$/.test(invitation.secret)){channel.close();throw new Error('Invalid approved room identity.');}
      if(a.session.id&&(a.session.id!==invitation.id||a.session.secret!==invitation.secret)){channel.close();throw new Error('This invitation belongs to a different saved match.');}
      if(!a.session.id){
        const previous=a.resumeCandidate;
        if(previous?.role==='guest'&&previous.id===invitation.id&&previous.secret!==invitation.secret){channel.close();throw new Error('The saved match identity did not match this host.');}
        if(previous?.role==='guest'&&previous.id===invitation.id&&previous.secret===invitation.secret){
          const code=a.session.inviteCode;Object.assign(a.session,previous,{inviteCode:code});
          const record=JSON.parse(storage.getItem(recordKey(a.session))||'null');
          a.last=record?.last;a.lastAt=record?.lastAt;a.outage=record?.outage;
        }else Object.assign(a.session,invitation);
      }
      const rpc=createPeerRPC(channel);
      channel.onClose(()=>{if(a.rpc===rpc)a.rpc=null;});
      try {
        const nonce=browserSecurity.randomHex(32);
        const reply=await rpc.request('hello',{nonce,proof:await peerProof(a.session.secret,a.session.id,nonce,'guest')});
        if(!browserSecurity.equalToken(reply.proof,await peerProof(a.session.secret,a.session.id,nonce,'host')))throw new Error('The peer did not prove ownership of this invitation.');
        if(a.closed)throw new Error('Room was closed.');
        a.rpc=rpc;return rpc;
      } catch(error){rpc.close();throw error;}
    })().finally(()=>a.connecting=null);
    return a.connecting;
  }
  function offline(a) {
    if(!a.last)throw new Error('Connection failed. Ask the creator for a fresh invitation and keep both tabs open.');
    if(!a.outage)a.outage={deadline:(a.lastAt||now())+15000+a.last.rules.disconnect.graceSeconds*1000,matchNumber:a.last.matchNumber,extensions:0};
    const room=structuredClone(a.last), time=now();
    room.serverTime=time;room.networkIssue=true;room.recovering=false;
    const host=room.players.find(p=>p.side!==room.you);if(host){host.connected=false;host.ready=false;}
    if(['playing','paused'].includes(room.phase)) {
      if(room.rules.clock.enabled && room.phase==='playing')room.clocks[room.position.turn]=Math.max(0,room.clocks[room.position.turn]-Math.min(15000,Math.max(0,time-a.lastAt)));
      room.phase='paused';room.reconnectDeadline=a.outage.deadline;
      if(room.rules.disconnect.mode==='end-without-result'||time>=a.outage.deadline || a.outage.resigned){room.phase='finished';room.result={winner:a.outage.resigned?(room.you==='blue'?'white':'blue'):null,reason:a.outage.resigned?'resignation':room.rules.disconnect.mode==='end-without-result'?'disconnected-no-result':'reconnect-timeout-no-result'};}
    }
    // Local outage views do not advance authoritative versions.
    persist(a);return room;
  }
  async function guestRead(a) {
    try {
      const rpc=await ensureGuest(a);
      const report=a.outage?{matchNumber:a.outage.matchNumber,remainingMs:a.outage.deadline-now(),resigned:!!a.outage.resigned}:undefined;
      const response=a.session.token ? await rpc.request('read',{token:a.session.token,report}) : await rpc.request('join',{guestKey:a.session.guestKey});
      if(response.token){a.session.token=response.token;saveSession(a.session);}
      const room=verifyPeerRoom(response,a.session.id);
      a.last=room;a.lastAt=now();a.outage=null;persist(a);return room;
    } catch(error){a.rpc?.close();a.rpc=null;if(!a.last)throw error;return offline(a);}
  }
  async function restore(session) {
    if(active?.session.id===session.id)return active;
    stop();
    const record=JSON.parse(storage.getItem(recordKey(session))||'null');
    if(session.role==='host') {
      if(!record?.snapshot)throw new Error('This browser no longer has the creator’s saved room.');
      return startHost(session,record.snapshot,record.guestKey);
    }
    active={session,last:record?.last,lastAt:record?.lastAt,outage:record?.outage,closed:false,abort:new AbortController()};
    return active;
  }
  return {
    savedSession,saveSession,forgetSession(){tabStorage.removeItem(SESSION);},stop,
    async create(data) {
      stop();
      if(data.rules.visibility!=='private')throw new Error('This P2P release supports invitation-only rooms.');
      for(let attempt=0;attempt<3;attempt++) {
        const invitation={id:browserSecurity.randomHex(9),secret:browserSecurity.randomHex(32)};
        const security={...browserSecurity,randomHex:bytes=>bytes===9?invitation.id:browserSecurity.randomHex(bytes)};
        const core=createRoomService({now,maxRooms:1,security});const result=core.create(data);
        const session={...invitation,token:result.token,role:'host'};
        let a;
        try {a=await startHost(session);} catch(error) {if(error.type==='unavailable-id'&&attempt<2)continue;throw error;}
        a.core=core;a.last=result.room;a.lastAt=now();persist(a);saveSession(session);
        return {...result,session};
      }
    },
    async join(code) {
      const resumeCandidate=savedSession();stop();const invitation=await parseInvitation(code);
      const session={...invitation,role:'guest',guestKey:browserSecurity.randomHex(32)};
      const a=active={session,resumeCandidate,closed:false,abort:new AbortController()};
      try {
        const rpc=await ensureGuest(a);
        if(session.token){const room=await guestRead(a);saveSession(session);return {room,session,token:session.token};}
        const result=await rpc.request('join',{guestKey:session.guestKey});
        const room=verifyPeerRoom(result,session.id);session.token=result.token;
        a.last=room;a.lastAt=now();persist(a);saveSession(session);
        return {room,session,token:session.token};
      } catch(error){stop();throw error;}
    },
    async read(session) {
      const a=await restore(session);if(a.failure)throw a.failure;
      return session.role==='host'?localRead(a):guestRead(a);
    },
    async action(session,action) {
      const a=await restore(session);if(a.failure)throw a.failure;
      if(session.role==='host'){const room=a.core.action(session.id,session.token,action);a.last=room;a.lastAt=now();persist(a);return room;}
      if(a.outage) {
        const room=offline(a);
        if(action.type==='extend'&&room.phase==='paused'){a.outage.deadline+=300000;a.outage.extensions++;persist(a);return offline(a);}
        if(action.type==='resign'&&room.rules.resignation&&room.phase==='paused'){a.outage.resigned=true;persist(a);return offline(a);}
        throw new Error('Wait for the creator to reconnect before playing.');
      }
      const rpc=await ensureGuest(a);const response=await rpc.request('action',{token:session.token,action});
      const room=verifyPeerRoom(response,session.id);a.last=room;a.lastAt=now();persist(a);return room;
    },
    invitation:session=>session?.role==='host'?(active?.session.id===session.id?active.peer?.invitationCode||'':session.inviteCode||''):'',
  };
}
