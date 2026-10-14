/** Board dimensions are asset data; game grids never resize the board. Units: metres. */
export function createBoardLayout(size, surface, pieces) {
  if (!Number.isInteger(size) || size < 2) throw new Error('Invalid grid size.');
  const cellWidth = surface.width / size;
  const cellDepth = surface.depth / size;
  const pieceScale = Math.min(cellWidth, cellDepth) * pieces.squareCoverage / pieces.diameter;
  return {
    size, cellWidth, cellDepth, pieceScale,
    center(row, column, level = 0) {
      if (![row, column].every(n => Number.isInteger(n) && n >= 0 && n < size)) throw new RangeError('Square outside board.');
      return { x: -surface.width / 2 + (column + 0.5) * cellWidth,
        y: surface.height + level * pieces.height * pieceScale,
        z: -surface.depth / 2 + (row + 0.5) * cellDepth };
    },
    squareAt(x, z) {
      const column = Math.floor((x + surface.width / 2) / cellWidth);
      const row = Math.floor((z + surface.depth / 2) / cellDepth);
      return row >= 0 && row < size && column >= 0 && column < size ? { row, column } : null;
    },
  };
}

export function initialPieces(game) {
  const rows = game.boardSize / 2 - 1;
  const bottom = game.id === 'american-checkers' ? 'blue' : 'white';
  const pieces = [];
  for (let row = 0; row < game.boardSize; row++) {
    if (row >= rows && row < game.boardSize - rows) continue;
    for (let column = 0; column < game.boardSize; column++) {
      if ((row + column) % 2 !== 1) continue;
      pieces.push({ id: `${row}-${column}`, row, column, king: false,
        side: row >= game.boardSize - rows ? bottom : bottom === 'blue' ? 'white' : 'blue' });
    }
  }
  return pieces;
}
