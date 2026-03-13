function isValidMove(board, fromRow, fromCol, toRow, toCol, currentTurn) {
  const piece = board[fromRow][fromCol];
  if (!piece || piece === " ") return false;
  const isWhitePiece = piece === piece.toUpperCase();
  if (currentTurn === "white" && !isWhitePiece) return false;
  if (currentTurn === "black" && isWhitePiece) return false;
  const target = board[toRow][toCol];
  if (target && target !== " ") {
    const targetIsWhite = target === target.toUpperCase();
    if (isWhitePiece === targetIsWhite) return false;
  }
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

function validatePawn(board, fr, fc, tr, tc, isWhite) {
  const dir = isWhite ? -1 : 1;
  const startRow = isWhite ? 6 : 1;
  const dr = tr - fr,
    dc = tc - fc;
  if (dc === 0 && dr === dir && board[tr][tc] === " ") return true;
  if (
    dc === 0 &&
    dr === 2 * dir &&
    fr === startRow &&
    board[fr + dir][fc] === " " &&
    board[tr][tc] === " "
  )
    return true;
  if (Math.abs(dc) === 1 && dr === dir && board[tr][tc] !== " ") return true;
  return false;
}
function validateRook(board, fr, fc, tr, tc) {
  if (fr !== tr && fc !== tc) return false;
  return !isPathBlocked(board, fr, fc, tr, tc);
}
function validateKnight(dr, dc) {
  return (
    (Math.abs(dr) === 2 && Math.abs(dc) === 1) ||
    (Math.abs(dr) === 1 && Math.abs(dc) === 2)
  );
}
function validateBishop(board, fr, fc, tr, tc) {
  if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
  return !isPathBlocked(board, fr, fc, tr, tc);
}
function validateQueen(board, fr, fc, tr, tc) {
  return (
    validateRook(board, fr, fc, tr, tc) || validateBishop(board, fr, fc, tr, tc)
  );
}
function validateKing(dr, dc) {
  return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
}
function isPathBlocked(board, fr, fc, tr, tc) {
  const stepR = Math.sign(tr - fr),
    stepC = Math.sign(tc - fc);
  let r = fr + stepR,
    c = fc + stepC;
  while (r !== tr || c !== tc) {
    if (board[r][c] !== " ") return true;
    r += stepR;
    c += stepC;
  }
  return false;
}

module.exports = { isValidMove };
