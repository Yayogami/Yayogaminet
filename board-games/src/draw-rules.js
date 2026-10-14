import { legalMoves } from './move-rules.js';

/** IDs do not affect repetition; side to move and crowned status do. */
export function positionKey(position) {
  return `${position.gameId}|${position.turn}|${position.pieces.map(p => `${p.row},${p.column},${p.side},${p.king ? 1 : 0}`).sort().join(';')}`;
}
const labels = {
  repetition: 'The same position has occurred three times with the same side to move.',
  'american-40': 'Each player has made 40 moves without a capture or an uncrowned man moving.',
  'international-25': 'Each player has made 25 moves using only kings without a capture.',
  'international-16': 'The 16-move endgame limit has been reached by both players.',
  'international-5': 'The five-move endgame limit has been reached by both players.',
};
const other = side => side === 'blue' ? 'white' : 'blue';

function newEndgameWindows(position) {
  const windows = [];
  for (const side of ['blue','white']) {
    const own = position.pieces.filter(p=>p.side===side), opponents = position.pieces.filter(p=>p.side!==side);
    if (own.length !== 1 || !own[0].king || !opponents.some(p=>p.king)) continue;
    if (opponents.length === 3) {
      windows.push({ key:`sixteen:${own[0].id}`, limit:16 });
      if (own[0].row + own[0].column === 9) windows.push({ key:`diagonal:${own[0].id}`, limit:5 });
    } else if (opponents.length === 1 || opponents.length === 2) {
      windows.push({ key:`five:${own[0].id}`, limit:5 });
    }
  }
  return windows;
}

/** History contains positions before each completed move, oldest first.
 * FMJD Annex 1 §6.3 counters survive captures; a newly qualifying ending starts
 * counting subsequent moves, not the move that created that ending.
 */
export function drawEligibility(position, history = []) {
  const moves = legalMoves(position);
  // A last-move win by capture or immobilization has priority over endgame limits.
  if (!moves.length) return { reasons: [], intendedMoves: [] };
  const positions = [...history, position];
  const counts = new Map();
  for (const state of positions) { const key=positionKey(state); counts.set(key,(counts.get(key)||0)+1); }
  const reasons = [];
  if (counts.get(positionKey(position)) >= 3) reasons.push('repetition');
  let quiet = 0;
  for (let i=positions.length-1; i>0; i--) {
    const move=positions[i].lastMove;
    if (!move?.wasKing || move.captures.length) break;
    quiet++;
  }
  if (position.gameId === 'american-checkers' && quiet >= 80) reasons.push('american-40');
  if (position.gameId === 'international-draughts') {
    if (quiet >= 50) reasons.push('international-25');
    const windows = new Map();
    for (let index=0; index<positions.length; index++) {
      const state=positions[index];
      if (index>0) for (const window of windows.values()) window.counts[positions[index-1].turn]++;
      for (const spec of newEndgameWindows(state)) if (!windows.has(spec.key)) windows.set(spec.key,{...spec,counts:{blue:0,white:0}});
    }
    for (const window of windows.values()) if (window.counts.blue >= window.limit && window.counts.white >= window.limit) reasons.push(`international-${window.limit}`);
  }
  const intendedMoves = [];
  if (position.gameId === 'american-checkers') {
    // WCDF §1.32.1 also permits a claim with a declared legal next move that
    // would produce the third occurrence. Captures/man advances cannot repeat.
    for (const move of moves) {
      const moving=position.pieces.find(p=>p.id===move.pieceId);
      if (!moving.king || move.captures.length) continue;
      const candidate={...position,turn:other(position.turn),pieces:position.pieces.map(p=>p.id===moving.id?{...p,...move.route.at(-1)}:p)};
      if ((counts.get(positionKey(candidate))||0)>=2) intendedMoves.push({pieceId:move.pieceId,route:move.route,reason:'repetition'});
    }
  }
  return { reasons: [...new Set(reasons)].map(code=>({code,label:labels[code]})), intendedMoves };
}

export function isEligibleClaim(eligibility, request = {}) {
  if (eligibility.reasons.length) return true;
  return eligibility.intendedMoves.some(move=>move.pieceId===request.pieceId && JSON.stringify(move.route)===JSON.stringify(request.route));
}
