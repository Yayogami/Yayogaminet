import { browserSecurity } from './room-security.js';
import { createDefaultRoomRules } from './room-rules.js';
import { createPosition, applyMove, immobilityResult, legalMoves } from './move-rules.js';
import { drawEligibility, isEligibleClaim } from './draw-rules.js';

const other = side => side === 'blue' ? 'white' : 'blue';
export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function requireValue(condition, message, status) { if (!condition) throw new RoomError(message, status); }
export function validateRoomRules(input) {
  const defaults = createDefaultRoomRules();
  requireValue(input && typeof input === 'object', 'Room rules are required.');
  requireValue(['blue', 'white'].includes(input.creatorSide), 'Choose your side.');
  requireValue(['private', 'public'].includes(input.visibility), 'Choose public or private.');
  defaults.creatorSide = input.creatorSide;
  defaults.visibility = input.visibility;
  for (const name of ['touchMove','legalMoveHints','resignation','drawOffers','mutuallyAgreedTakebacks','rematches']) {
    requireValue(typeof input[name] === 'boolean', `Invalid rule: ${name}.`);
    defaults[name] = input[name];
  }
  requireValue(typeof input.clock?.enabled === 'boolean', 'Choose whether the clock is enabled.');
  requireValue(Number.isSafeInteger(input.clock.initialSeconds) && input.clock.initialSeconds > 0, 'Starting time must be positive whole seconds.');
  requireValue(Number.isSafeInteger(input.clock.incrementSeconds) && input.clock.incrementSeconds >= 0 && input.clock.incrementSeconds % 15 === 0, 'Increment must use 15-second steps.');
  Object.assign(defaults.clock, { enabled: input.clock.enabled, initialSeconds: input.clock.initialSeconds, incrementSeconds: input.clock.incrementSeconds });
  requireValue(['reconnect','end-without-result'].includes(input.disconnect?.mode), 'Invalid disconnection rule.');
  defaults.disconnect.mode = input.disconnect.mode;
  return defaults;
}

/** Shared room engine for browser peers and the local HTTP regression server. */
export function createRoomService({ now = Date.now, disconnectAfterMs = 15000, maxRooms = 200, savedState = null, security = browserSecurity } = {}) {
  const rooms = new Map();
  if (savedState) {
    requireValue(savedState.version === 1 && Array.isArray(savedState.rooms), 'Unsupported saved room data.');
    for (const saved of savedState.rooms) {
      const room = structuredClone(saved);
      requireValue(/^[a-f0-9]{18}$/.test(room.id) && Array.isArray(room.players), 'Invalid saved room.');
      room.rules = validateRoomRules(room.rules);
      for (const p of room.players) { p.connected = false; p.ready = false; }
      if (['playing','paused'].includes(room.phase)) { room.phase = 'paused'; room.recovering = true; }
      room.lastClockAt = null; room.deadline = null; room.revision++;
      rooms.set(room.id, room);
    }
  }
  function player(side) { return { side, token: security.randomHex(24), ready: false, lastSeen: now(), connected: true }; }
  function get(id) { const room = rooms.get(id); requireValue(room, 'Room not found.', 404); return room; }
  function authenticate(room, token) {
    requireValue(typeof token === 'string' && /^[a-f0-9]{48}$/.test(token), 'Room access required.', 401);
    
    const seat = room.players.find(p => security.equalToken(p.token, token));
    requireValue(seat, 'Room access required.', 401);
    return seat;
  }
  function refreshDraws(room) { room.draws = drawEligibility(room.position, room.history.map(entry=>entry.position)); }
  function finish(room, result) { room.phase = 'finished'; room.result = result; room.lastClockAt = null; room.deadline = null; room.pending = null; room.revision++; }
  function propose(room, seat, type) {
    requireValue(!room.pending, 'Respond to the pending request first.', 409);
    room.pending = { id: security.randomHex(8), type, by: seat.side, ply: room.position.ply, matchNumber: room.matchNumber };
    room.revision++;
  }
  function clockStep(room, time) {
    if (room.phase !== 'playing' || !room.rules.clock.enabled || room.lastClockAt === null) return;
    const side = room.position.turn;
    room.clocks[side] = Math.max(0, room.clocks[side] - Math.max(0, time - room.lastClockAt));
    room.lastClockAt = time;
    if (room.clocks[side] === 0) finish(room, { winner: other(side), reason: 'time' });
  }
  function tickRoom(room, time) {
    // Stop the clock at the first missed heartbeat deadline, not at the next poll.
    const firstExpired = Math.min(...room.players.filter(p => p.connected).map(p => p.lastSeen + disconnectAfterMs));
    clockStep(room, Math.min(time, firstExpired));
    for (const p of room.players) {
      if (p.connected && time >= p.lastSeen + disconnectAfterMs) {
        p.connected = false; p.ready = false; room.revision++;
        if (room.phase === 'playing') {
          if (room.rules.disconnect.mode === 'end-without-result') finish(room, { winner: null, reason: 'disconnected-no-result' });
          else {
            room.phase = 'paused'; room.lastClockAt = null;
            room.deadline = p.lastSeen + disconnectAfterMs + room.rules.disconnect.graceSeconds * 1000;
            room.disconnectUntil = room.deadline;
          }
        }
      }
    }
    if (room.phase === 'paused' && !room.recovering && time >= room.deadline) finish(room, { winner: null, reason: 'reconnect-timeout-no-result' });
  }
  function access(id, token) {
    const room = get(id), seat = authenticate(room, token), time = now();
    tickRoom(room, time);
    seat.lastSeen = time;
    if (!seat.connected) {
      seat.connected = true; room.revision++;
      if (room.phase === 'paused' && room.players.every(p => p.connected)) {
        room.phase = 'playing'; room.lastClockAt = time; room.deadline = null; room.recovering = false;
      }
    }
    return { room, seat };
  }
  function view(room, seat) {
    return { id: room.id, gameId: room.gameId, rules: room.rules, phase: room.phase,
      revision: room.revision, you: seat.side, creator: seat === room.players[0],
      players: room.players.map(p => ({ side: p.side, ready: p.ready, connected: p.connected })),
      position: room.position, clocks: room.clocks, serverTime: now(), reconnectDeadline: room.deadline, recovering: !!room.recovering,
      result: room.result, selectedPiece: room.selectedPiece, draws: room.draws, pending: room.pending, matchNumber: room.matchNumber, positionVersion: room.positionVersion };
  }
  return {
    // Server-only snapshot: includes private credentials; never send through an API.
    snapshot() { return structuredClone({ version: 1, rooms: [...rooms.values()] }); },
    reconcilePeerReturn(id, token, report) {
      const room=get(id), seat=authenticate(room,token);
      requireValue(seat===room.players[1], 'Only the returning peer may report its disconnected interval.', 409);
      requireValue(report?.matchNumber===room.matchNumber && Number.isFinite(report.remainingMs), 'Invalid reconnect report.', 409);
      tickRoom(room,now());
      if (report.resigned && room.rules.resignation && ['playing','paused'].includes(room.phase)) finish(room,{winner:other(seat.side),reason:'resignation'});
      else if (room.rules.disconnect.mode==='end-without-result' && ['playing','paused'].includes(room.phase)) finish(room,{winner:null,reason:'disconnected-no-result'});
      else if (room.rules.disconnect.mode==='reconnect' && (room.phase==='paused' || room.result?.reason==='reconnect-timeout-no-result')) {
        // Both sides may extend while their direct link is down. Reconcile the
        // longer grace period before resuming; there is no central time oracle.
        const remaining=Math.max((room.disconnectUntil || 0)-now(),report.remainingMs);
        if(remaining<=0)finish(room,{winner:null,reason:'reconnect-timeout-no-result'});
        else {room.phase='paused';room.result=null;room.recovering=false;room.deadline=now()+remaining;room.disconnectUntil=room.deadline;room.revision++;}
      }
      return this.read(id,token);
    },
    create({ gameId, rules }) {
      requireValue(['american-checkers','international-draughts'].includes(gameId), 'Unknown game.');
      requireValue(rooms.size < maxRooms, 'The development server has reached its room limit.', 503);
      const validated = validateRoomRules(rules), creator = player(validated.creatorSide);
      const room = { id: security.randomHex(9), gameId, rules: validated, players: [creator], phase: 'waiting', revision: 1,
        position: createPosition(gameId), clocks: { blue: validated.clock.initialSeconds * 1000, white: validated.clock.initialSeconds * 1000 },
        lastClockAt: null, deadline: null, result: null, selectedPiece: null, history: [], pending: null, matchNumber: 1, positionVersion: 0,
        turnStartClocks: { blue: validated.clock.initialSeconds * 1000, white: validated.clock.initialSeconds * 1000 } };
      refreshDraws(room);
      rooms.set(room.id, room);
      return { token: creator.token, room: view(room, creator) };
    },
    list(gameId) {
      this.tick();
      return [...rooms.values()].filter(r => r.rules.visibility === 'public' && r.gameId === gameId && r.phase === 'waiting' && r.players.length === 1 && r.players[0].connected)
        .map(r => ({ id: r.id, gameId: r.gameId, rules: r.rules }));
    },
    join(id) {
      const room = get(id); tickRoom(room, now());
      requireValue(room.phase === 'waiting' && room.players.length === 1, 'This room is full or has already started.', 409);
      requireValue(room.players[0].connected, 'The room creator is disconnected.', 409);
      const guest = player(other(room.players[0].side)); room.players.push(guest); room.revision++;
      return { token: guest.token, room: view(room, guest) };
    },
    read(id, token) { const { room, seat } = access(id, token); return view(room, seat); },
    action(id, token, action) {
      const { room, seat } = access(id, token);
      requireValue(action && typeof action === 'object', 'Invalid room action.');
      requireValue(action.matchNumber === room.matchNumber, 'That action belongs to an earlier match. Refresh the room.', 409);
      if (['move','select','claim-draw','request-takeback'].includes(action.type)) requireValue(action.positionVersion === room.positionVersion, 'The board has changed. Review it before acting.', 409);
      if (action.type === 'ready') {
        requireValue(room.phase === 'waiting', 'The match has already started.', 409);
        requireValue(typeof action.ready === 'boolean', 'Invalid ready state.');
        seat.ready = action.ready; room.revision++;
        if (room.players.length === 2 && room.players.every(p => p.ready && p.connected)) { room.phase = 'playing'; room.lastClockAt = now(); }
      } else if (action.type === 'extend') {
        requireValue(room.phase === 'paused' && !room.recovering && room.players.some(p => !p.connected), 'There is no reconnect deadline to extend.', 409);
        room.deadline += room.rules.disconnect.extensionSeconds * 1000; room.revision++;
        room.disconnectUntil = room.deadline;
      } else if (action.type === 'select') {
        requireValue(room.phase === 'playing' && seat.side === room.position.turn, 'It is not your turn.', 409);
        requireValue(action.ply === room.position.ply, 'This selection is out of date.', 409);
        const playable = legalMoves(room.position).some(move => move.pieceId === action.pieceId);
        if (playable && room.rules.touchMove && !room.selectedPiece) { room.selectedPiece = action.pieceId; room.revision++; }
      } else if (action.type === 'move') {
        requireValue(room.phase === 'playing', 'The match is not accepting moves.', 409);
        requireValue(seat.side === room.position.turn, 'It is your opponent’s turn.', 409);
        requireValue(action.ply === room.position.ply, 'This move is out of date. Reload the position.', 409);
        requireValue(!room.rules.touchMove || room.selectedPiece, 'Select a playable piece first.', 409);
        requireValue(!room.selectedPiece || action.pieceId === room.selectedPiece, 'Touch-move locks the selected piece.', 409);
        let next;
        try { next = applyMove(room.position, action); } catch { throw new RoomError('Illegal or incomplete move route.'); }
        if (action.offerDraw) {
          requireValue(room.rules.drawOffers, 'Draw offers are disabled.', 409);
          requireValue(room.gameId !== 'international-draughts' || next.ply >= room.rules.draughtsDrawOfferMinimumMoves * 2, 'Both players must complete 40 moves before a draw offer.', 409);
          requireValue(!room.pending || room.pending.by !== seat.side, 'A request is already pending.', 409);
        }
        room.history.push({ position: room.position, clocks: { ...room.turnStartClocks } });
        room.position = next; room.positionVersion++; room.selectedPiece = null;
        if (room.rules.clock.enabled) room.clocks[seat.side] += room.rules.clock.incrementSeconds * 1000;
        room.turnStartClocks = { ...room.clocks };
        if (room.pending && (room.pending.type === 'takeback' || room.pending.by !== seat.side)) room.pending = null;
        room.lastClockAt = now(); room.revision++;
        refreshDraws(room);
        const result = immobilityResult(next);
        if (result) finish(room, result);
        else if (action.offerDraw) propose(room, seat, 'draw');
      } else if (action.type === 'claim-draw') {
        requireValue(room.phase === 'playing', 'The match is not accepting draw claims.', 409);
        requireValue(action.ply === room.position.ply, 'This claim is out of date.', 409);
        requireValue(room.draws.reasons.length || seat.side === room.position.turn, 'Only the moving player can declare an intended move.', 409);
        requireValue(isEligibleClaim(room.draws, action), 'This position or intended move is not eligible for a draw.', 409);
        finish(room, { winner: null, draw: true, reason: 'claimed-draw', drawReason: room.draws.reasons[0]?.code || 'repetition' });
      } else if (action.type === 'offer-draw') {
        requireValue(room.phase === 'playing' && room.rules.drawOffers, 'Draw offers are unavailable.', 409);
        requireValue(room.gameId === 'american-checkers', 'For draughts, offer a draw with your confirmed move.', 409);
        propose(room, seat, 'draw');
      } else if (action.type === 'request-takeback') {
        requireValue(room.phase === 'playing' && room.rules.mutuallyAgreedTakebacks && room.history.length, 'A takeback is unavailable.', 409);
        requireValue(action.ply === room.position.ply, 'The position has changed. Review the latest move first.', 409);
        propose(room, seat, 'takeback');
      } else if (action.type === 'request-rematch') {
        requireValue(room.phase === 'finished' && room.rules.rematches, 'A rematch is unavailable.', 409);
        propose(room, seat, 'rematch');
      } else if (action.type === 'respond') {
        const pending = room.pending;
        requireValue(pending && pending.id === action.requestId, 'That request is no longer pending.', 409);
        requireValue(pending.by !== seat.side, 'Only the opponent can respond.', 409);
        requireValue(typeof action.accept === 'boolean', 'Choose accept or decline.');
        requireValue(room.phase === (pending.type === 'rematch' ? 'finished' : 'playing'), 'Reconnect before responding.', 409);
        if (action.accept && pending.type === 'draw') finish(room, { winner: null, draw: true, reason: 'agreed-draw' });
        if (action.accept && pending.type === 'takeback') {
          const previous = room.history.pop();
          room.position = previous.position; room.positionVersion++; room.clocks = { ...previous.clocks }; room.turnStartClocks = { ...previous.clocks };
          room.selectedPiece = null; room.lastClockAt = now(); refreshDraws(room);
        }
        if (action.accept && pending.type === 'rematch') {
          requireValue(room.players.every(p=>p.connected), 'Both players must be connected for a rematch.', 409);
          for (const p of room.players) { p.side = other(p.side); p.ready = false; }
          room.rules.creatorSide = room.players[0].side; room.matchNumber++;
          room.position = createPosition(room.gameId); room.positionVersion++; room.history = []; room.result = null; room.phase = 'waiting';
          room.clocks = { blue: room.rules.clock.initialSeconds * 1000, white: room.rules.clock.initialSeconds * 1000 };
          room.turnStartClocks = { ...room.clocks }; room.selectedPiece = null; room.lastClockAt = null; room.deadline = null; refreshDraws(room);
        }
        room.pending = null; room.revision++;
      } else if (action.type === 'resign') {
        requireValue(room.rules.resignation && ['playing','paused'].includes(room.phase), 'Resignation is unavailable.', 409);
        finish(room, { winner: other(seat.side), reason: 'resignation' });
      } else throw new RoomError('Unknown room action.');
      return view(room, seat);
    },
    tick() { for (const room of rooms.values()) tickRoom(room, now()); },
  };
}

