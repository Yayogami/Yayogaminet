import { createPeerRooms } from './peer-rooms.js';
const rooms=createPeerRooms();
export const createRoom=data=>rooms.create(data);
export const joinRoom=code=>rooms.join(code);
export const readRoom=session=>rooms.read(session);
export const roomInvitation=session=>rooms.invitation(session);
export const savedRoom=()=>rooms.savedSession();
export const rememberRoom=session=>rooms.saveSession(session);
export const forgetRoom=()=>rooms.forgetSession();
export function connectRoom(session,onRoom,onError,initialRoom=null) {
  let stopped=false,timer=null,latest=initialRoom;
  function receive(room) {
    if(!room.networkIssue && latest && !latest.networkIssue && (room.revision<latest.revision || (room.revision===latest.revision && room.serverTime<latest.serverTime)))return;
    latest=room;onRoom(room);
  }
  async function poll(){
    try{const room=await rooms.read(session);if(!stopped)receive(room);}catch(error){if(!stopped)onError(error);}
    if(!stopped)timer=setTimeout(poll,1000);
  }
  poll();
  return {
    async action(data){
      const room=await rooms.action(session,{...data,matchNumber:latest?.matchNumber,positionVersion:latest?.positionVersion});
      if(!stopped)receive(room);return room;
    },
    stop(){stopped=true;clearTimeout(timer);rooms.stop();},
  };
}
