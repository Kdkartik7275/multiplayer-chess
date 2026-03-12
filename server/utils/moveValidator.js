function isValidMove(board, fromRow, fromCol, toRow, toCol, currentTurn) {
  const piece = board[fromRow][fromCol];
  if (!piece || piece === " ") return false;

  // Piece must belong to the player whose turn it is
  const isWhitePiece = piece === piece.toUpperCase();
  if (currentTurn === "white" && !isWhitePiece) return false;
  if (currentTurn === "black" && isWhitePiece) return false;

  // Can't move to a square occupied by own piece
  const target = board[toRow][toCol];
  if (target && target !== " ") {
    const targetIsWhite = target === target.toUpperCase();
    if (isWhitePiece === targetIsWhite) return false;
  }

  // Can't stay in place
  if (fromRow === toRow && fromCol === toCol) return false;

  const p = piece.toLowerCase();
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;

  switch (p) {
    case "p":
      return validatePawn(board, fromRow, fromCol, toRow, toCol, isWhitePiece);
    case "r":
      return validateRook(board, fromRow, fromCol, toRow, toCol);
    case "n":
      return validateKnight(dr, dc);
    case "b":
      return validateBishop(board, fromRow, fromCol, toRow, toCol);
    case "q":
      return validateQueen(board, fromRow, fromCol, toRow, toCol);
    case "k":
      return validateKing(dr, dc);
    default:
      return false;
  }
}

// ── Individual piece validators ──────────────────────────

function validatePawn(board, fr, fc, tr, tc, isWhite) {
  const dir = isWhite ? -1 : 1; // White moves up (-1 row), Black down (+1)
  const startRow = isWhite ? 6 : 1;
  const dr = tr - fr;
  const dc = tc - fc;

  // Single step forward into empty square
  if (dc === 0 && dr === dir && board[tr][tc] === " ") return true;

  // Double step from starting row (both squares must be empty)
  if (
    dc === 0 &&
    dr === 2 * dir &&
    fr === startRow &&
    board[fr + dir][fc] === " " &&
    board[tr][tc] === " "
  )
    return true;

  // Diagonal capture
  if (Math.abs(dc) === 1 && dr === dir && board[tr][tc] !== " ") return true;

  return false;
}

function validateRook(board, fr, fc, tr, tc) {
  // Must move along a rank or file (not diagonal)
  if (fr !== tr && fc !== tc) return false;
  return !isPathBlocked(board, fr, fc, tr, tc);
}

function validateKnight(dr, dc) {
  // L-shape: 2 squares one way, 1 the other
  return (
    (Math.abs(dr) === 2 && Math.abs(dc) === 1) ||
    (Math.abs(dr) === 1 && Math.abs(dc) === 2)
  );
}

function validateBishop(board, fr, fc, tr, tc) {
  // Must move diagonally (equal row and column delta)
  if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
  return !isPathBlocked(board, fr, fc, tr, tc);
}

function validateQueen(board, fr, fc, tr, tc) {
  // Queen = Rook + Bishop combined
  return (
    validateRook(board, fr, fc, tr, tc) || validateBishop(board, fr, fc, tr, tc)
  );
}

function validateKing(dr, dc) {
  // One square in any direction
  return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
}

// ── Helper: check if any piece stands between two squares ──

function isPathBlocked(board, fr, fc, tr, tc) {
  const stepR = Math.sign(tr - fr);
  const stepC = Math.sign(tc - fc);
  let r = fr + stepR;
  let c = fc + stepC;

  while (r !== tr || c !== tc) {
    if (board[r][c] !== " ") return true; // Piece in the way
    r += stepR;
    c += stepC;
  }
  return false;
}

module.exports = { isValidMove };
