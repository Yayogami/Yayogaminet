import { createPosition, applyMove } from './move-rules.js';
import { drawEligibility } from './draw-rules.js';
import { validateRoomRules } from './room-engine.js';

export function verifyPeerRoom(packet, expectedId) {
  const { room, moves }=packet || {};
  if(!room || room.id!==expectedId || !['american-checkers','international-draughts'].includes(room.gameId) || !Array.isArray(moves))throw new Error('Invalid peer room.');
  validateRoomRules(room.rules);
  if(room.rules.visibility!=='private' || !['blue','white'].includes(room.you) || !['waiting','playing','paused','finished'].includes(room.phase))throw new Error('Invalid peer room settings.');
  let position=createPosition(room.gameId);const history=[];
  for(const move of moves){history.push(position);position=applyMove(position,move);}
  if(JSON.stringify(position)!==JSON.stringify(room.position))throw new Error('Peer sent a position that does not match legal play.');
  if(!Number.isSafeInteger(room.revision) || !Number.isSafeInteger(room.positionVersion) || !Number.isSafeInteger(room.matchNumber) || !Number.isFinite(room.serverTime))throw new Error('Invalid peer state version.');
  for(const side of ['blue','white'])if(!Number.isFinite(room.clocks?.[side]) || room.clocks[side]<0)throw new Error('Invalid peer clock.');
  // Compute eligibility locally; do not trust an opponent's suggested draw claim.
  return {...room,draws:drawEligibility(position,history)};
}
