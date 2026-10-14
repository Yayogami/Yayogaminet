/** Deterministic move generation shared by the future server and client.
 * American: WCDF rules 1.15–1.21; international: supplied FMJD 2024 Annex 1.
 * Draw adjudication, clocks and room actions belong to the match layer.
 */
import { initialPieces } from './board-layout.js';

const variants = {
  'american-checkers': { size: 8, first: 'blue', bottom: 'blue', flyingKings: false, backwardCaptures: false, maximumCapture: false, crownEndsTurn: true },
  'international-draughts': { size: 10, first: 'white', bottom: 'white', flyingKings: true, backwardCaptures: true, maximumCapture: true, crownEndsTurn: false },
};
const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const key = (row, column) => `${row},${column}`;
const other = side => side === 'blue' ? 'white' : 'blue';
function variant(gameId) {
  if (!variants[gameId]) throw new Error('Unknown game rules.');
  return variants[gameId];
}
function forward(rules, side) { return side === rules.bottom ? -1 : 1; }
function crowned(rules, piece, row) { return row === (forward(rules, piece.side) < 0 ? 0 : rules.size - 1); }

export function createPosition(gameId) {
  const rules = variant(gameId);
  return { gameId, turn: rules.first, pieces: initialPieces({ id: gameId, boardSize: rules.size }), ply: 0 };
}

export function legalMoves(position) {
  const rules = variant(position.gameId);
  const inside = (r, c) => r >= 0 && r < rules.size && c >= 0 && c < rules.size;
  const occupied = new Map(position.pieces.map(p => [key(p.row, p.column), p]));
  const own = position.pieces.filter(p => p.side === position.turn);
  const captures = [];
  for (const piece of own) {
    // Captured pieces remain obstacles until the whole route finishes. The moving
    // piece's origin is vacant; revisiting a landing square is permitted.
    const board = new Map(occupied);
    board.delete(key(piece.row, piece.column));
    function walk(row, column, route, taken) {
      let extended = false;
      const directions = piece.king || rules.backwardCaptures ? diagonals : diagonals.filter(([dr]) => dr === forward(rules, piece.side));
      for (const [dr, dc] of directions) {
        let r = row + dr, c = column + dc;
        if (piece.king && rules.flyingKings) {
          while (inside(r, c) && !board.has(key(r, c))) { r += dr; c += dc; }
        }
        if (!inside(r, c)) continue;
        const victim = board.get(key(r, c));
        if (!victim || victim.side === piece.side || taken.includes(victim.id)) continue;
        r += dr; c += dc;
        while (inside(r, c) && !board.has(key(r, c))) {
          extended = true;
          const nextRoute = [...route, { row: r, column: c }];
          const nextTaken = [...taken, victim.id];
          if (!piece.king && rules.crownEndsTurn && crowned(rules, piece, r)) {
            captures.push({ pieceId: piece.id, route: nextRoute, captures: nextTaken, promotes: true });
          } else walk(r, c, nextRoute, nextTaken);
          if (!(piece.king && rules.flyingKings)) break;
          r += dr; c += dc;
        }
      }
      if (!extended && taken.length) captures.push({ pieceId: piece.id, route, captures: taken,
        promotes: !piece.king && crowned(rules, piece, row) });
    }
    walk(piece.row, piece.column, [], []);
  }
  if (captures.length) {
    const maximum = Math.max(...captures.map(move => move.captures.length));
    return rules.maximumCapture ? captures.filter(move => move.captures.length === maximum) : captures;
  }
  const moves = [];
  for (const piece of own) {
    for (const [dr, dc] of piece.king ? diagonals : diagonals.filter(([r]) => r === forward(rules, piece.side))) {
      let row = piece.row + dr, column = piece.column + dc;
      while (inside(row, column) && !occupied.has(key(row, column))) {
        moves.push({ pieceId: piece.id, route: [{ row, column }], captures: [], promotes: !piece.king && crowned(rules, piece, row) });
        if (!(piece.king && rules.flyingKings)) break;
        row += dr; column += dc;
      }
    }
  }
  return moves;
}

export function applyMove(position, request) {
  // Validate the entire route; never trust client-supplied capture IDs or promotion.
  const routeKey = route => JSON.stringify(route?.map(square => [square.row, square.column]));
  const move = legalMoves(position).find(move => move.pieceId === request.pieceId && routeKey(move.route) === routeKey(request.route));
  if (!move) throw new Error('Illegal or incomplete move route.');
  const destination = move.route.at(-1);
  const moving = position.pieces.find(p => p.id === move.pieceId);
  const pieces = position.pieces.filter(piece => !move.captures.includes(piece.id)).map(piece => piece.id === move.pieceId
    ? { ...piece, ...destination, king: piece.king || move.promotes } : { ...piece });
  return { ...position, pieces, turn: other(position.turn), ply: position.ply + 1,
    lastMove: { ...move, side: position.turn, wasKing: moving.king } };
}

export function immobilityResult(position) {
  return legalMoves(position).length ? null : { winner: other(position.turn), reason: 'no-legal-moves' };
}
